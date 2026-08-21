DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE tablename = 'sources') <> 4 THEN
    RAISE EXCEPTION 'expected 4 RLS policies on public.sources, found %', (SELECT count(*) FROM pg_policies WHERE tablename = 'sources');
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = 'sources') THEN
    RAISE EXCEPTION 'RLS not enabled on public.sources';
  END IF;
  RAISE NOTICE 'OK: 4 policies + RLS enabled on public.sources';
END
$verify$;
