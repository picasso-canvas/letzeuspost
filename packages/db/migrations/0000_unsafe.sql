-- Throwaway (#67): not for merging. Locks writes on the table while the index builds.
CREATE INDEX workspace_name ON workspace (name);
