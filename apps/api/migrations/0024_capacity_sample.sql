CREATE INDEX external_full_capacity_sample ON external_full_members(source COLLATE "C",external_id COLLATE "C") WHERE sampled AND last_detail_at IS NOT NULL;
