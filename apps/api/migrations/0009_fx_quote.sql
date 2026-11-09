-- Internal conversion input only. Do not expose a rates feed or redistribute the provider response.
CREATE FUNCTION valid_public_fx_rates(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE entry record; amount numeric; low numeric; high numeric;
BEGIN
 IF jsonb_typeof(value) <> 'object' OR value->>'USD' IS DISTINCT FROM '1' THEN RETURN false; END IF;
 FOR entry IN SELECT * FROM jsonb_each(value) LOOP
  IF jsonb_typeof(entry.value) <> 'string' OR (entry.value #>> '{}') !~ '^(0|[1-9][0-9]{0,6})(\.[0-9]{1,12})?$' THEN RETURN false; END IF;
  amount := (entry.value #>> '{}')::numeric;
  CASE entry.key
   WHEN 'USD' THEN low:=1; high:=1;
   WHEN 'CNY' THEN low:=0.1; high:=100;
   WHEN 'EUR' THEN low:=0.01; high:=100;
   WHEN 'GBP' THEN low:=0.01; high:=100;
   WHEN 'AED' THEN low:=0.1; high:=100;
   WHEN 'RUB' THEN low:=1; high:=10000;
   WHEN 'KRW' THEN low:=10; high:=100000;
   WHEN 'KZT' THEN low:=1; high:=100000;
   WHEN 'UZS' THEN low:=10; high:=1000000;
   WHEN 'GEL' THEN low:=0.01; high:=1000;
   WHEN 'AMD' THEN low:=1; high:=100000;
   WHEN 'KGS' THEN low:=1; high:=10000;
   WHEN 'ALL' THEN low:=1; high:=10000;
   WHEN 'JPY' THEN low:=1; high:=100000;
   ELSE RETURN false;
  END CASE;
  IF amount < low OR amount > high THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE TABLE public_fx_quote (
 id integer PRIMARY KEY CHECK(id=1),
 version uuid NOT NULL DEFAULT gen_random_uuid(),
 source text NOT NULL CHECK(source IN ('exchange_rate_api','synthetic')),
 as_of timestamptz NOT NULL CHECK(isfinite(as_of) AND as_of >= '2000-01-01T00:00:00Z'),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 rates jsonb NOT NULL CHECK(valid_public_fx_rates(rates)),
 CHECK(expires_at>as_of AND expires_at<=as_of+interval '168 hours')
);
CREATE FUNCTION version_public_fx_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.version:=gen_random_uuid(); RETURN NEW; END IF;
 IF ROW(OLD.source,OLD.as_of,OLD.expires_at,OLD.rates) IS DISTINCT FROM ROW(NEW.source,NEW.as_of,NEW.expires_at,NEW.rates)
 THEN NEW.version:=gen_random_uuid(); ELSE NEW.version:=OLD.version; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_fx_assign_version BEFORE INSERT OR UPDATE ON public_fx_quote
 FOR EACH ROW EXECUTE FUNCTION version_public_fx_quote();
CREATE FUNCTION invalidate_public_fx_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP <> 'UPDATE' OR OLD.version IS DISTINCT FROM NEW.version THEN
  PERFORM public.queue_public_catalog_change();
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER public_fx_changed AFTER INSERT OR UPDATE OR DELETE ON public_fx_quote
 FOR EACH ROW EXECUTE FUNCTION invalidate_public_fx_quote();
--> statement-breakpoint

-- Claim commits before network I/O; a failed/timed-out/terminated refresh consumes the attempt.
CREATE TABLE fx_refresh_state (
 id integer PRIMARY KEY CHECK(id=1),
 attempt_id uuid,
 last_attempt_at timestamptz,
 next_attempt_at timestamptz,
 outcome text NOT NULL DEFAULT 'never' CHECK(outcome IN ('never','pending','success','failed')),
 CHECK ((attempt_id IS NULL) = (last_attempt_at IS NULL)),
 CHECK ((last_attempt_at IS NULL) = (next_attempt_at IS NULL)),
 CHECK (next_attempt_at >= last_attempt_at+interval '24 hours')
);
INSERT INTO fx_refresh_state(id) VALUES(1);
