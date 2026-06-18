-- Esquema sugerido: cache persistente de bairros OSM por município (PostgreSQL + PostGIS).
-- Execute uma vez no banco zapmass (ajuste schema se necessário).

CREATE TABLE IF NOT EXISTS geo.municipality_neighborhood_cache (
  id              BIGSERIAL PRIMARY KEY,
  city_name       TEXT NOT NULL,
  state_code      CHAR(2) NOT NULL,
  ibge_municipio_id INTEGER,
  source          TEXT NOT NULL DEFAULT 'overpass',
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  neighborhood_count INTEGER NOT NULL DEFAULT 0,
  payload         JSONB NOT NULL,
  UNIQUE (city_name, state_code)
);

CREATE TABLE IF NOT EXISTS geo.neighborhoods (
  id              BIGSERIAL PRIMARY KEY,
  municipality_cache_id BIGINT NOT NULL REFERENCES geo.municipality_neighborhood_cache(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_key        TEXT NOT NULL,
  osm_id          BIGINT,
  osm_type        TEXT,
  place_type      TEXT,
  admin_level     TEXT,
  centroid        GEOGRAPHY(POINT, 4326) NOT NULL,
  geom            GEOGRAPHY(GEOMETRY, 4326),
  bbox            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (municipality_cache_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_geo_neighborhoods_muni ON geo.neighborhoods (municipality_cache_id);
CREATE INDEX IF NOT EXISTS idx_geo_neighborhoods_centroid ON geo.neighborhoods USING GIST (centroid);
