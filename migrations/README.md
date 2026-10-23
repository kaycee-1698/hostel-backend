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

- Run `npm test` in `backend` for API-service regression checks.
- Against an **empty disposable PostgreSQL database**, run
  `psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/atomicBookingUpdate.sql`
  from `backend`. This checks a full room, a forced insert failure after
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
`SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` (or the backend hosting
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

## 013 — Collect booking payments

Apply `013_collect_booking_payment.sql` after 010 and 011. The collect-payment
endpoint adds an amount to the existing paid total under a booking row lock,
recomputes the pending balance/status, and preserves the agreed price and taxes.
Positive amounts with up to two decimals are accepted, up to the current balance
and ₹1,000,000 per payment. The existing ₹5 paid-status tolerance is preserved.
A request UUID makes retries safe. The popup keeps unresolved requests in browser
session storage and retries the same amount/UUID after an uncertain result.
Payments appear in the dated payment history and activity logs (including an
explicit Collected payment entry). Nothing is inserted in the separate legacy
payments table, which is not used for dashboard totals. Existing balances are
unchanged by installation. No external payment gateway or money transfer occurs;
this records money already received by staff.

## 014 — Extras items and payments

Apply `014_extras_manager.sql` after 011. Seeds the supplied prices for towels,
dental kits, shampoo, conditioner, body wash, locks, early check-in and laundry.
Merchandise, fines and events are unpriced until configured. No booking totals
or existing payments are changed.

Items can be added, repriced, removed from sale (active=false), and restored.
Paid extras are stored separately with immutable item-name/category/unit-price
snapshots, quantity, payment date/method, notes and an optional booking reference.
The booking name remains available even if that booking is later deleted.
Extras do not reduce or add to accommodation balances and are reported on the
Extras page, not in the dashboard's accommodation sales/payments totals.

Sale creation uses a UUID receipt and transaction lock for safe retries. Payment
history is paginated, filters are applied in the database, and totals include all
matching recorded entries, not just the current page. Voiding an incorrect entry
requires a reason, excludes it from totals, retains history and does not transfer
or refund money. Item changes, recorded payments and voids appear in Activity Logs.
Only the backend service role can access these features; staff identity integration
remains pending along with the rest of the app. No stock/inventory tracking or
unpaid extras balances are introduced.

### 015_extras_orders.sql
Run after 014. Adds multi-item sales (including the Toiletries category), unpaid balances and atomic, idempotent partial/full collection. Existing sales remain fully paid; original line prices and booking balances are preserved. Unpaid sales require a booking or customer name. Pending dashboard totals cover all dates and exclude voids. Collections retain amount, method and timestamp in `extra_collections` and appear in activity logs. Extras history dates refer to the sale date; received totals are cumulative receipts against matching sales, not receipts received within that date range.

### 016_invoices.sql
Creates on-demand, immutable invoice snapshots and a unique UH financial-year series. One issued invoice per booking; manual invoices are independent. Request UUIDs prevent duplicate retries. Re-downloads preserve amounts and payment status as at issue. The app defaults to 5% tax-exclusive prices as requested, with editable line taxes and CGST/SGST or IGST breakdowns. Linked, non-voided extras and received payments are included. Invoice-only edits do not change booking/extras ledgers. No invoices or PDFs are pre-generated. PDFKit renders A4 PDFs on demand from the saved snapshot. Invoice issuance appears in activity logs.

## 017 — Room catalogue
Run `017_room_catalogue.sql` in Supabase SQL Editor. Existing rooms become dormitories; existing bookings and rates are unchanged. Adds descriptions, ordered promotional photos, and the public `room-photos` bucket. Uploads use the backend service credential; guest IDs remain in their separate private bucket. New private-room occupancy is exclusive and new price quotes charge once per room/night. Configure each private room's beds to represent its maximum guest capacity.

## 018 — Property details
Run `018_property_details.sql` after 017. Adds the property profile, public `property-photos` bucket, version-checked saves and activity logs. The guest website reads published content through `/public/property`; set its `BACKEND_URL` to the backend address. Admin edits publish on Save. Existing bookings and rooms are unchanged. Photos removed from the profile no longer appear on the website; stored objects are retained, including abandoned uploads, pending a future cleanup policy.
