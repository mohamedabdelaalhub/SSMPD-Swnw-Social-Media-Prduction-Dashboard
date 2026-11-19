-- Restores auto_book_one without the first-two-names branch. Bookings already linked by it stay linked.
begin;
do $$
declare def text; s int; e int;
begin
  def := pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure);
  s := position(E'      elsif n_same = 0 and n_phone = 1 and clinic_reception.name_first_two' in def);
  if s > 0 then
    e := position(E'      elsif n_phone > 0 then' in def);
    execute substr(def, 1, s - 1) || substr(def, e);
  end if;
end $$;
drop function if exists clinic_reception.name_first_two(text);
commit;
