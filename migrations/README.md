# Atomic booking edits

Apply `001_atomic_booking_update.sql` in the Supabase SQL Editor **before**
deploying the backend change. The function uses the existing table definitions
described in the root README; verify these match your project. No existing
records are changed by installation.

Booking edits requiring reassignment now call this function. It checks every
requested room, excludes the current booking's own beds, and commits the booking
and all allocations together. Any error rolls back the entire call. If the
function is missing, the API fails without attempting separate writes.

The function uses caller privileges (`SECURITY INVOKER`), so existing grants and
RLS still apply. The backend database role must have the table permissions needed
for the updates and locks. No elevated grants or RLS bypass are added here.

Allocation writes are serialized with table locks for the duration of each edit.
Reads remain available, but simultaneous writes wait. This prioritizes correctness
for a small hostel; higher-volume deployments should move all allocation writers
to a shared transactional strategy. This change does not repair the separate
booking-creation flow or direct assignment endpoints.

Verification:

- Run `npm test` in `hostel-backend` for API-service regression checks.
- Against an **empty disposable PostgreSQL database**, run
  `psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/atomicBookingUpdate.sql`
  from `hostel-backend`. This checks a full room, a forced insert failure after
  deletion, and a successful extension using the original bed. Fixtures and the
  function installation are rolled back at the end.
- Before release, verify the migration and the same scenarios in a staging copy
  of the actual Supabase schema, using the backend's database role.

## Guest documents (migration 002)

Apply `002_guest_documents.sql` before deploying the guest check-in changes. It
creates the private `guest-documents` bucket and the `create_guest_with_images`
function. The backend role needs Storage upload permissions and database access
for the function. Do not expose its key to the frontend. Existing records are
not changed by installation. See `../../BUG_FIX_SUMMARY.md` for deployment details
and remaining limitations.

The additional disposable-database test is `tests/guestDocuments.sql`; it checks
that a failed image insert rolls back the guest and that successful image records
reference the new guest. It is not a live-project migration.
