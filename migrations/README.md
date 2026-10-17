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

## Booking creation permissions and automatic bed assignment

Migration 007 keeps duplicate-save receipts private using RLS. The backend needs
its own Supabase secret/service-role credential, configured as
`SUPABASE_SERVICE_ROLE_KEY` in `hostel-backend/.env` (or the backend hosting
provider's environment settings). Restart the backend after changing it.
`SUPABASE_API_KEY` remains a fallback for existing server configurations.
Never put this credential in frontend files or any `NEXT_PUBLIC_` variable.
Do not disable RLS or grant anonymous access to the receipt table to fix this error.

New booking requests select dorms and guest counts. The backend allocates beds
available for the entire stay, ignoring a preferred bed from older clients.
No additional SQL migration is required for this automatic-allocation change;
migrations 006 and 007 must already be installed.

## Room rates (migration 008)

Run `008_room_rates.sql` once before starting the updated application. It sets
all existing rooms' new base rate to ₹600 and requires a base rate for future
rooms. Daily overrides have a unique room/date key and save atomically through
`save_room_daily_rates`. Use the backend secret/service-role credential; RLS
keeps the override table private. Booking amounts are not changed.

Browser-only preview rooms and rates are not imported. The calendar uses the
stored daily override, falling back to the room's base rate. Bulk saves omit
rooms with empty price fields. Test `tests/roomRates.sql` only in an empty,
disposable database.

## Restoring base rates (migration 009)

Apply `009_restore_base_rates.sql` after 008. It replaces the rate-saving function
so a null rate removes that date's override atomically with other edits. It does
not modify existing rates or booking amounts when installed.

Rate reads now require `start` and `end` date parameters. New-booking quotes sum
occupied nights (checkout excluded), times the allocated beds in each room,
using daily overrides or the room base rate. Quotes exclude taxes and never
update existing booking amounts; the entered booking price remains authoritative.

## Live admin dashboard (migration 010)

Apply `010_dashboard_payment_history.sql` once before deploying the dashboard.
It records changes to `bookings.payment_received` in a private dated ledger.
Opening balances are retained as undated entries, not assigned an invented date.
Negative corrections reduce net receipts. Deleting a booking retains its payment
history with a null booking reference. The separate legacy `payments` CRUD table
is not added to this total, avoiding double counting the booking payment total.

The dashboard uses India dates, actual bed records, and checkout-exclusive
occupancy. Monthly accommodation sales prorate agreed booking base amounts
uniformly across occupied nights; they never use today's room rate. Outstanding
balances include the full balance of each booking overlapping the month, once.
The dashboard shows recorded net receipts for the month and flags undated opening
entries. These are operational figures, not a tax or financial accounting report.

`node scripts/seedDashboardMonth.js 2026-10` previews demo data; add `--apply` to
create it in the configured database. Only use an explicitly approved test dataset.
Each booking is labelled with a stable month/room/day marker and deterministic
request ID. Re-runs skip existing slots. The script uses atomic availability checks,
leaves spare beds, creates no guests or ID documents, and never deletes existing
bookings. Demo receipts are dated to arrival or today for future deposits.

## 011 — Activity logs

Apply `011_activity_logs.sql` once in Supabase SQL Editor before using Activity Logs.
It creates an append-only history of successful booking, room, bed, assignment,
nightly rate, guest, payment and guest-document record changes. Existing records
are unchanged; past actions cannot be reconstructed. All history is retained,
including deleted records. No cleanup job is installed.

Triggers write in the same transaction as the change, including atomic booking
RPCs, swaps, undo and bulk rate updates. No-op updates create no entry; failed or
rolled-back transactions create no entry. One action can produce several entries
(e.g. one rate entry per room/date, or both sides of a bed swap). These are data
change logs, not page-view/click tracking or failed-request diagnostics. Direct
SQL changes to the covered tables are captured too. Derived payment-history rows
and duplicate-request receipts are not logged again.

User and role are fixed to Admin until authenticated identities are implemented;
`actor_id` is reserved for that integration. Do not trust an actor supplied by a
browser. Trigger execution is restricted and only the database owner writes log
rows; the backend service role has read access only. Guest identity values,
contact details, free-text notes, document URLs and signatures are not copied.
Changed field names remain visible for updates to excluded values.

`GET /activity-logs` supports `period=today|custom|all`, inclusive `start`/`end`
dates (Asia/Kolkata), `action`, `entity`, literal `search`, and `page` (50 per page).
The default is today; this limits the display, not storage. No schema change is
needed later to keep or archive older logs.

## 012 — Manual assignment logs only

Apply `012_manual_assignment_logs.sql` after 011. Existing logs are untouched.
New booking allocation and booking-deletion cleanup no longer create assignment
entries. Booking edits still log explicitly chosen room allocation changes, but
not automatically selected beds or synchronized assignment dates. Manual bed
moves, swaps, undo and direct assignment endpoints continue to log normally.
Booking create/update/delete logs are unaffected. A private transaction-keyed context table is restored after successful calls and
rolls back on failure; suppression does not carry over to another action. This
uses no custom PostgreSQL settings, which Supabase can restrict. If the previous
version of 012 failed with a parameter-permission error, run the entire revised
012 file. Its transaction preserves existing data and logs.
