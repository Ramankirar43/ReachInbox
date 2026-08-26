CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, google_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, avatar TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS attachments (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), file_name TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, file_data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS emails (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), recipient TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, hourly_limit INTEGER NOT NULL DEFAULT 200, attachment_id UUID REFERENCES attachments(id), status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, provider_message_id TEXT, error TEXT, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE emails ADD COLUMN IF NOT EXISTS hourly_limit INTEGER NOT NULL DEFAULT 200;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachment_id UUID REFERENCES attachments(id);
CREATE INDEX IF NOT EXISTS emails_user_status_idx ON emails(user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_scheduled_idx ON emails(scheduled_at) WHERE status = 'scheduled';
