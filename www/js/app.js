-- 1. Purani sabhi error wali tables hamesha ke liye delete
DROP TABLE IF EXISTS consumers CASCADE;
DROP TABLE IF EXISTS lines CASCADE;
DROP TABLE IF EXISTS dts CASCADE;
DROP TABLE IF EXISTS poles CASCADE;
DROP TABLE IF EXISTS feeders CASCADE;
DROP TABLE IF EXISTS gss_nodes CASCADE;
DROP TABLE IF EXISTS survey_data CASCADE;

-- 2. Sirf ek "Universal Table" jo kabhi crash nahi hogi
CREATE TABLE network_elements (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data JSONB NOT NULL,
    user_id UUID NOT NULL
);

-- 3. Live Tracking On
ALTER PUBLICATION supabase_realtime ADD TABLE network_elements;
