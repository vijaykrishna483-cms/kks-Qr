-- Drop old table if migrating
-- DROP TABLE IF EXISTS qr_codes;

CREATE TABLE qr_codes (
    uuid       VARCHAR(255) PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    email      VARCHAR(255) NOT NULL,          -- NOT unique; one person has multiple QR rows
    food_type  VARCHAR(50)  NOT NULL,          -- 'Non-Veg' or 'Veg'
    used       BOOLEAN      DEFAULT FALSE
);
