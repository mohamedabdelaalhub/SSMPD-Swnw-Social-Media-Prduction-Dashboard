-- Reload PostgREST's schema cache so task RPCs created by the task module migration are visible.
notify pgrst, 'reload schema';
