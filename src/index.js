import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { pool } from './db.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const carouselPath = path.join(__dirname, '..', 'data', 'carousel.json')

const EVENT_ID = 1

const app = express()
app.use(cors())
app.use(express.json())

function readCarousel() {
  try {
    const raw = fs.readFileSync(carouselPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { slides: [] }
  }
}

async function ensureFamilyInEvent(client, familyId) {
  const r = await client.query(
    `SELECT id, family_name, contact_phone, contact_email FROM family WHERE id = $1 AND event_id = $2`,
    [familyId, EVENT_ID]
  )
  return r.rows[0] || null
}

async function ensureRsvpForGuests(client, familyId) {
  await client.query(
    `
    INSERT INTO rsvp (guest_id, status, attendance)
    SELECT g.id, 'pendiente'::rsvp_status, 'presencial'::attendance_type
    FROM guest g
    LEFT JOIN rsvp r ON r.guest_id = g.id
    WHERE g.family_id = $1 AND r.id IS NULL
    `,
    [familyId]
  )
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/carousel', (_req, res) => {
  res.json(readCarousel())
})

app.get('/api/families/:familyId/invitation', async (req, res) => {
  const familyId = Number(req.params.familyId)
  if (!Number.isInteger(familyId) || familyId < 1) {
    return res.status(400).json({ error: 'familyId inválido' })
  }
  const client = await pool.connect()
  try {
    const family = await ensureFamilyInEvent(client, familyId)
    if (!family) {
      return res.status(404).json({ error: 'Familia no encontrada' })
    }

    await ensureRsvpForGuests(client, familyId)

    const [event, venues, sponsors, schedule, guests, extraRow] = await Promise.all([
      client.query(`SELECT id, name, description, event_date FROM event WHERE id = $1`, [EVENT_ID]),
      client.query(
        `SELECT id, name, address, type, start_time, end_time FROM venue WHERE event_id = $1 ORDER BY type, id`,
        [EVENT_ID]
      ),
      client.query(
        `SELECT id, name, role FROM sponsor WHERE event_id = $1 ORDER BY id`,
        [EVENT_ID]
      ),
      client.query(
        `SELECT id, title, description, start_time, end_time FROM schedule WHERE event_id = $1 ORDER BY start_time NULLS LAST, id`,
        [EVENT_ID]
      ),
      client.query(
        `
        SELECT g.id, g.name, g.is_primary, g.is_additional, r.status AS rsvp_status
        FROM guest g
        JOIN rsvp r ON r.guest_id = g.id
        WHERE g.family_id = $1
        ORDER BY g.is_primary DESC, g.is_additional ASC, g.id
        `,
        [familyId]
      ),
      client.query(`SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM extra_ticket WHERE family_id = $1`, [
        familyId,
      ]),
    ])

    const extraTicketQuantity = extraRow.rows[0]?.qty ?? 0

    res.json({
      family,
      event: event.rows[0] || null,
      venues: venues.rows,
      sponsors: sponsors.rows,
      schedule: schedule.rows,
      guests: guests.rows,
      extraTicketQuantity,
      carousel: readCarousel(),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Error al cargar la invitación' })
  } finally {
    client.release()
  }
})

app.patch('/api/families/:familyId/rsvp', async (req, res) => {
  const familyId = Number(req.params.familyId)
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : []
  if (!Number.isInteger(familyId) || familyId < 1) {
    return res.status(400).json({ error: 'familyId inválido' })
  }
  const client = await pool.connect()
  try {
    const family = await ensureFamilyInEvent(client, familyId)
    if (!family) {
      return res.status(404).json({ error: 'Familia no encontrada' })
    }

    const allowed = new Set(['pendiente', 'confirmado', 'rechazado'])

    await client.query('BEGIN')
    try {
      for (const u of updates) {
        const guestId = Number(u.guestId)
        const status = u.status
        if (!Number.isInteger(guestId) || !allowed.has(status)) continue

        const g = await client.query(`SELECT id FROM guest WHERE id = $1 AND family_id = $2`, [guestId, familyId])
        if (g.rowCount === 0) continue

        await client.query(
          `
          UPDATE rsvp
          SET status = $1::rsvp_status,
              confirmed_at = CASE WHEN $1::text = 'confirmado' THEN NOW() ELSE NULL END
          WHERE guest_id = $2
          `,
          [status, guestId]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    await ensureRsvpForGuests(client, familyId)
    const guests = await client.query(
      `
      SELECT g.id, g.name, g.is_primary, g.is_additional, r.status AS rsvp_status
      FROM guest g
      JOIN rsvp r ON r.guest_id = g.id
      WHERE g.family_id = $1
      ORDER BY g.is_primary DESC, g.is_additional ASC, g.id
      `,
      [familyId]
    )
    res.json({ guests: guests.rows })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(e)
    res.status(500).json({ error: 'No se pudo actualizar la asistencia' })
  } finally {
    client.release()
  }
})

app.post('/api/families/:familyId/guests/extra', async (req, res) => {
  const familyId = Number(req.params.familyId)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!Number.isInteger(familyId) || familyId < 1) {
    return res.status(400).json({ error: 'familyId inválido' })
  }
  if (!name || name.length > 150) {
    return res.status(400).json({ error: 'Nombre inválido' })
  }

  const client = await pool.connect()
  try {
    const family = await ensureFamilyInEvent(client, familyId)
    if (!family) {
      return res.status(404).json({ error: 'Familia no encontrada' })
    }

    const extraRes = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS qty FROM extra_ticket WHERE family_id = $1`,
      [familyId]
    )
    const maxExtra = extraRes.rows[0]?.qty ?? 0

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS c FROM guest WHERE family_id = $1 AND is_additional = TRUE`,
      [familyId]
    )
    const currentExtra = countRes.rows[0]?.c ?? 0

    if (maxExtra <= 0) {
      return res.status(400).json({ error: 'No hay boletos extra para esta familia' })
    }
    if (currentExtra >= maxExtra) {
      return res.status(400).json({ error: 'Ya registraste el máximo de invitados extra' })
    }

    await client.query('BEGIN')
    const ins = await client.query(
      `
      INSERT INTO guest (family_id, name, is_primary, is_additional)
      VALUES ($1, $2, FALSE, TRUE)
      RETURNING id
      `,
      [familyId, name]
    )
    const newId = ins.rows[0].id
    await client.query(
      `
      INSERT INTO rsvp (guest_id, status, attendance)
      VALUES ($1, 'pendiente'::rsvp_status, 'presencial'::attendance_type)
      `,
      [newId]
    )
    await client.query('COMMIT')

    const guests = await client.query(
      `
      SELECT g.id, g.name, g.is_primary, g.is_additional, r.status AS rsvp_status
      FROM guest g
      JOIN rsvp r ON r.guest_id = g.id
      WHERE g.family_id = $1
      ORDER BY g.is_primary DESC, g.is_additional ASC, g.id
      `,
      [familyId]
    )
    res.status(201).json({ guests: guests.rows })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(e)
    res.status(500).json({ error: 'No se pudo agregar el invitado' })
  } finally {
    client.release()
  }
})

app.patch('/api/families/:familyId/guests/:guestId', async (req, res) => {
  const familyId = Number(req.params.familyId)
  const guestId = Number(req.params.guestId)
  if (!Number.isInteger(familyId) || !Number.isInteger(guestId)) {
    return res.status(400).json({ error: 'Parámetros inválidos' })
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : null
  const status = req.body?.rsvpStatus

  const client = await pool.connect()
  try {
    const family = await ensureFamilyInEvent(client, familyId)
    if (!family) {
      return res.status(404).json({ error: 'Familia no encontrada' })
    }

    const guestRow = await client.query(
      `SELECT id, is_additional FROM guest WHERE id = $1 AND family_id = $2`,
      [guestId, familyId]
    )
    if (guestRow.rowCount === 0) {
      return res.status(404).json({ error: 'Invitado no encontrado' })
    }
    if (!guestRow.rows[0].is_additional) {
      return res.status(400).json({ error: 'Solo se puede editar el nombre de invitados extra' })
    }

    if (name !== null) {
      if (!name || name.length > 150) {
        return res.status(400).json({ error: 'Nombre inválido' })
      }
      await client.query(`UPDATE guest SET name = $1 WHERE id = $2`, [name, guestId])
    }

    const allowed = new Set(['pendiente', 'confirmado', 'rechazado'])
    if (status !== undefined) {
      if (!allowed.has(status)) {
        return res.status(400).json({ error: 'Estado de asistencia inválido' })
      }
      await client.query(
        `
        UPDATE rsvp
        SET status = $1::rsvp_status,
            confirmed_at = CASE WHEN $1::text = 'confirmado' THEN NOW() ELSE NULL END
        WHERE guest_id = $2
        `,
        [status, guestId]
      )
    }

    const guests = await client.query(
      `
      SELECT g.id, g.name, g.is_primary, g.is_additional, r.status AS rsvp_status
      FROM guest g
      JOIN rsvp r ON r.guest_id = g.id
      WHERE g.family_id = $1
      ORDER BY g.is_primary DESC, g.is_additional ASC, g.id
      `,
      [familyId]
    )
    res.json({ guests: guests.rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'No se pudo actualizar el invitado' })
  } finally {
    client.release()
  }
})

app.post('/api/families/:familyId/messages', async (req, res) => {
  const familyId = Number(req.params.familyId)
  const senderName = typeof req.body?.senderName === 'string' ? req.body.senderName.trim() : ''
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  const guestId = req.body?.guestId != null ? Number(req.body.guestId) : null

  if (!Number.isInteger(familyId) || familyId < 1) {
    return res.status(400).json({ error: 'familyId inválido' })
  }
  if (!senderName || senderName.length > 150) {
    return res.status(400).json({ error: 'Nombre del remitente obligatorio' })
  }
  if (!content || content.length > 4000) {
    return res.status(400).json({ error: 'Mensaje inválido' })
  }

  const client = await pool.connect()
  try {
    const family = await ensureFamilyInEvent(client, familyId)
    if (!family) {
      return res.status(404).json({ error: 'Familia no encontrada' })
    }

    if (guestId != null && Number.isInteger(guestId)) {
      const g = await client.query(`SELECT id FROM guest WHERE id = $1 AND family_id = $2`, [guestId, familyId])
      if (g.rowCount === 0) {
        return res.status(400).json({ error: 'Invitado no pertenece a la familia' })
      }
    }

    let row
    try {
      const ins = await client.query(
        `
        INSERT INTO message (guest_id, sender_name, family_id, content)
        VALUES ($1, $2, $3, $4)
        RETURNING id, created_at
        `,
        [Number.isInteger(guestId) ? guestId : null, senderName, familyId, content]
      )
      row = ins.rows[0]
    } catch (e) {
      if (e.code === '42703') {
        const ins = await client.query(
          `INSERT INTO message (guest_id, content) VALUES ($1, $2) RETURNING id, created_at`,
          [Number.isInteger(guestId) ? guestId : null, `De: ${senderName}\n\n${content}`]
        )
        row = ins.rows[0]
      } else {
        throw e
      }
    }

    res.status(201).json({ id: row.id, createdAt: row.created_at })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'No se pudo guardar el mensaje' })
  } finally {
    client.release()
  }
})

const port = Number(process.env.PORT || 3000)
app.listen(port, () => {
  console.log(`API xv_hanna en http://192.168.100.119:${port}`)
})
