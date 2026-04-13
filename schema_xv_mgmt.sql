-- =========================
-- ENUMS
-- =========================

CREATE TYPE event_type AS ENUM ('misa', 'fiesta');
CREATE TYPE rsvp_status AS ENUM ('pendiente', 'confirmado', 'rechazado');
CREATE TYPE attendance_type AS ENUM ('presencial', 'virtual');

-- =========================
-- EVENTO
-- =========================

CREATE TABLE event (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    event_date DATE NOT NULL
);

-- =========================
-- LUGARES
-- =========================

CREATE TABLE venue (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES event(id) ON DELETE CASCADE,
    name VARCHAR(150),
    address TEXT,
    type event_type NOT NULL,
    start_time TIME,
    end_time TIME
);

-- =========================
-- CRONOGRAMA
-- =========================

CREATE TABLE schedule (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES event(id) ON DELETE CASCADE,
    title VARCHAR(150),
    description TEXT,
    start_time TIMESTAMP,
    end_time TIMESTAMP
);

-- =========================
-- PADRINOS
-- =========================

CREATE TABLE sponsor (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES event(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    role VARCHAR(100) -- ej: padrino de vals, vestido, etc
);

-- =========================
-- FAMILIAS
-- =========================

CREATE TABLE family (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES event(id) ON DELETE CASCADE,
    family_name VARCHAR(150) NOT NULL,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(150)
);

-- =========================
-- INVITADOS
-- =========================

CREATE TABLE guest (
    id SERIAL PRIMARY KEY,
    family_id INT REFERENCES family(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE, -- contacto principal
    is_additional BOOLEAN DEFAULT FALSE -- invitados extra
);

-- =========================
-- BOLETOS
-- =========================

CREATE TABLE ticket (
    id SERIAL PRIMARY KEY,
    family_id INT REFERENCES family(id) ON DELETE CASCADE,
    code CHAR(4) NOT NULL UNIQUE, -- código de 4 dígitos
    total_allowed INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- BOLETOS EXTRA
-- =========================

CREATE TABLE extra_ticket (
    id SERIAL PRIMARY KEY,
    family_id INT REFERENCES family(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity >= 0),
    reason TEXT
);

-- =========================
-- RSVP (CONFIRMACIONES)
-- =========================

CREATE TABLE rsvp (
    id SERIAL PRIMARY KEY,
    guest_id INT REFERENCES guest(id) ON DELETE CASCADE,
    status rsvp_status DEFAULT 'pendiente',
    attendance attendance_type DEFAULT 'presencial',
    confirmed_at TIMESTAMP
);

-- =========================
-- CHECK-IN
-- =========================

CREATE TABLE checkin (
    id SERIAL PRIMARY KEY,
    guest_id INT REFERENCES guest(id) ON DELETE CASCADE,
    checkin_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guest_id)
);

-- =========================
-- MENSAJES
-- =========================

CREATE TABLE message (
    id SERIAL PRIMARY KEY,
    guest_id INT REFERENCES guest(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- LINKS DE VIDEOS / MEDIA
-- =========================

CREATE TABLE media_link (
    id SERIAL PRIMARY KEY,
    guest_id INT REFERENCES guest(id) ON DELETE SET NULL,
    url TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);