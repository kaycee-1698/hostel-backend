const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9AAAAABJRU5ErkJggg==';

function service(options = {}) {
  const uploads = [], removals = [], calls = [];
  const supabase = {
    storage: { from(bucket) {
      assert.equal(bucket, 'guest-documents');
      return {
        async upload(objectPath, bytes, settings) {
          uploads.push({ objectPath, bytes, settings });
          return { error: options.failUpload === uploads.length ? { message: 'Storage failed' } : null };
        },
        async remove(paths) { removals.push(...paths); return { error: null }; },
      };
    } },
    async rpc(name, args) {
      calls.push({ name, args });
      return options.rpcResult || { data: { guest_id: 42, ...args.p_guest }, error: null };
    },
  };
  const sandbox = { module: { exports: {} }, Buffer, require(name) {
    return name === '../utils/supabase' ? { supabase } : require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/guestService.js'), 'utf8'), sandbox);
  return { ...sandbox.module.exports, uploads, removals, calls };
}
const input = { first_name: 'Guest', booking_id: 7, birthday: '', id_front: png, signature: png };

test('uploads private images and saves guest plus references together', async () => {
  const s = service();
  const result = await s.createGuestService(input);
  assert.equal(result.guest_id, 42);
  assert.equal(s.uploads.length, 2);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].name, 'create_guest_with_images');
  assert.equal(s.calls[0].args.p_guest.birthday, null);
  assert.equal(s.calls[0].args.p_guest.booking_id, 7);
  assert.equal(s.calls[0].args.p_guest.id_front, undefined);
  assert.equal(s.calls[0].args.p_images[1].image_type, 'signature');
  assert.match(s.calls[0].args.p_images[0].imageURL, /^guest-documents\/[0-9a-f-]+\/id_front.png$/);
  assert.equal(s.uploads[0].settings.upsert, false);
});

test('rejects malformed or oversized images before any storage or database write', async () => {
  for (const image of ['https://example.com/fake.png', 'data:image/png;base64,aGVsbG8=',
    'data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024)]) {
    const s = service();
    await assert.rejects(s.createGuestService({ ...input, signature: image }), error => error.status === 400);
    assert.equal(s.uploads.length, 0);
    assert.equal(s.calls.length, 0);
  }
});

test('failed upload prevents guest creation and removes earlier uploaded files', async () => {
  const s = service({ failUpload: 2 });
  await assert.rejects(s.createGuestService(input), /Could not upload/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.removals.length, 1);
  assert.equal(s.removals[0], s.uploads[0].objectPath);
});

test('database errors are reported; potentially committed documents are retained', async () => {
  const s = service({ rpcResult: { error: { message: 'RPC response lost' } } });
  await assert.rejects(s.createGuestService(input), /Check the guest list before retrying/);
  assert.equal(s.removals.length, 0);
});

test('guests without optional images still save, and invalid bookings are rejected', async () => {
  const s = service();
  await s.createGuestService({ first_name: 'Guest', booking_id: 7 });
  assert.equal(s.uploads.length, 0);
  assert.equal(s.calls[0].args.p_images.length, 0);
  for (const booking_id of [undefined, 0, -1, 1.5]) {
    await assert.rejects(s.createGuestService({ first_name: 'Guest', booking_id }), error => error.status === 400);
  }
});
