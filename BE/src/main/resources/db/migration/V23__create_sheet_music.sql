-- 155번 내 악보 보관. 곡과 연결하지 않는 회원별 악보(이미지 1~20장 또는 PDF 1개).
CREATE TABLE sheet_music (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id bigint NOT NULL REFERENCES users(id),
    title varchar(100) NOT NULL CHECK (btrim(title) <> ''),
    source varchar(10) NOT NULL CHECK (source IN ('RENDERED', 'UPLOADED')),
    kind varchar(5) NOT NULL CHECK (kind IN ('IMAGE', 'PDF')),
    page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 20),
    total_bytes bigint NOT NULL CHECK (total_bytes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (kind = 'IMAGE' OR page_count = 1)
);
CREATE INDEX sheet_music_owner_idx ON sheet_music (owner_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE sheet_music_pages (
    sheet_id bigint NOT NULL REFERENCES sheet_music(id) ON DELETE CASCADE,
    page_no integer NOT NULL CHECK (page_no BETWEEN 1 AND 20),
    object_key varchar(300) NOT NULL UNIQUE CHECK (btrim(object_key) <> ''),
    content_type varchar(30) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    bytes bigint NOT NULL CHECK (bytes > 0),
    width integer CHECK (width > 0),
    height integer CHECK (height > 0),
    PRIMARY KEY (sheet_id, page_no)
);

ALTER TABLE file_cleanup_tasks DROP CONSTRAINT file_cleanup_tasks_file_role_check;
ALTER TABLE file_cleanup_tasks ADD CONSTRAINT file_cleanup_tasks_file_role_check CHECK (file_role IN
    ('SOURCE','DRUM_STEM','ACCOMPANIMENT','SHEET_PAGE','RAW_LOG','RECORDING','STAGING','COVER','SHEET_MUSIC'));
