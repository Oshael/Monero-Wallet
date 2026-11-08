// Project-specific contracts for the pinned LWS deletion extension.
#include "framework.test.h"
#include "db/storage.test.h"
#include "db/string.h"
#include "error.h"
#include "common/util.h"
#include <boost/filesystem/operations.hpp>
#include <thread>
#include <cstdlib>

namespace
{
  struct wallet_keys
  {
    lws::db::account_address address{};
    crypto::secret_key view{};
    wallet_keys()
    {
      crypto::generate_keys(address.spend_public, view);
      crypto::generate_keys(address.view_public, view);
    }
  };

  lws::db::account read_account(lws::db::storage& db, const wallet_keys& keys)
  {
    return MONERO_UNWRAP(MONERO_UNWRAP(db.start_read()).get_account(keys.address)).second;
  }

  lws::db::storage reopen(lws::db::storage& db)
  {
    { auto closed = std::move(db); }
    const auto configured = std::getenv("LWS_TEST_DATABASE");
    const auto path = configured ? std::string{configured} : tools::get_default_data_dir() + "light_wallet_server_unit_testing";
    return lws::db::storage::open(path.c_str(), 5);
  }
}

LWS_CASE("wallet deletion authentication and registration replay")
{
  lws::db::test::cleanup_db cleanup;
  auto db = lws::db::test::get_fresh_db();
  wallet_keys wallet, other;
  EXPECT(db.add_account(wallet.address, wallet.view));
  const auto initial = read_account(db, wallet);
  const auto token = MONERO_UNWRAP(db.prepare_account_delete(wallet.address, wallet.view));
  EXPECT(MONERO_UNWRAP(db.prepare_account_delete(wallet.address, wallet.view)) == token);
  EXPECT(!db.prepare_account_delete(wallet.address, other.view));
  EXPECT(!db.delete_account(wallet.address, other.view, token));
  EXPECT(!db.delete_account(wallet.address, wallet.view, crypto::rand<crypto::hash>()));
  EXPECT(read_account(db, wallet).id == initial.id);
  EXPECT(MONERO_UNWRAP(db.delete_account(wallet.address, wallet.view, token)));
  EXPECT(!MONERO_UNWRAP(db.start_read()).get_account(wallet.address));
  EXPECT(MONERO_UNWRAP(db.delete_account(wallet.address, wallet.view, token)));
  db = reopen(db);
  EXPECT(db.add_account(wallet.address, wallet.view));
  EXPECT(read_account(db, wallet).id > initial.id);
  EXPECT(!db.delete_account(wallet.address, wallet.view, token));
  EXPECT(!db.prepare_account_delete(other.address, other.view));
  const auto replacement = MONERO_UNWRAP(db.prepare_account_delete(wallet.address, wallet.view));
  EXPECT(replacement != token);
  EXPECT(!db.delete_account(wallet.address, wallet.view, token));
  EXPECT(MONERO_UNWRAP(db.delete_account(wallet.address, wallet.view, replacement)));
}

LWS_CASE("wallet deletion removes pending credentials and protects administrators")
{
  lws::db::test::cleanup_db cleanup;
  auto db = lws::db::test::get_fresh_db();
  wallet_keys pending, admin;
  EXPECT(db.creation_request(pending.address, pending.view, lws::db::account_flags::default_account, {}));
  const auto token = MONERO_UNWRAP(db.prepare_account_delete(pending.address, pending.view));
  EXPECT(MONERO_UNWRAP(db.delete_account(pending.address, pending.view, token)));
  const auto accepted = db.accept_requests(lws::db::request::create, {&pending.address, 1}, 2000);
  EXPECT(accepted);
  EXPECT(accepted->empty());
  EXPECT(!db.prepare_account_delete(pending.address, pending.view));
  // A rejected pending request is a different registration after retry.
  EXPECT(db.creation_request(pending.address, pending.view, lws::db::account_flags::default_account, {}));
  const auto rejected_token = MONERO_UNWRAP(db.prepare_account_delete(pending.address, pending.view));
  EXPECT(db.reject_requests(lws::db::request::create, {&pending.address, 1}));
  EXPECT(db.creation_request(pending.address, pending.view, lws::db::account_flags::default_account, {}));
  EXPECT(!db.delete_account(pending.address, pending.view, rejected_token));
  const auto fresh_token = MONERO_UNWRAP(db.prepare_account_delete(pending.address, pending.view));
  EXPECT(fresh_token != rejected_token);
  EXPECT(MONERO_UNWRAP(db.delete_account(pending.address, pending.view, fresh_token)));
  EXPECT(db.add_account(admin.address, admin.view, lws::db::account_flags::admin_account));
  const auto admin_token = MONERO_UNWRAP(db.prepare_account_delete(admin.address, admin.view));
  EXPECT(!db.delete_account(admin.address, admin.view, admin_token));
  EXPECT(MONERO_UNWRAP(db.start_read()).get_account(admin.address));
  wallet_keys combined;
  const auto flags = lws::db::account_flags(lws::db::account_flags::admin_account | lws::db::account_flags::account_generated_locally);
  EXPECT(db.add_account(combined.address, combined.view, flags));
  const auto combined_token = MONERO_UNWRAP(db.prepare_account_delete(combined.address, combined.view));
  EXPECT(!db.delete_account(combined.address, combined.view, combined_token));
  EXPECT(MONERO_UNWRAP(db.start_read()).get_account(combined.address));
}

LWS_CASE("wallet deletion resumes bounded cleanup and preserves shared images")
{
  lws::db::test::cleanup_db cleanup;
  auto db = lws::db::test::get_fresh_db();
  wallet_keys wallet, other;
  EXPECT(db.add_account(wallet.address, wallet.view));
  EXPECT(db.add_account(other.address, other.view));
  const auto initial = read_account(db, wallet);
  const auto other_initial = read_account(db, other);
  const auto last = MONERO_UNWRAP(MONERO_UNWRAP(db.start_read()).get_last_block());
  lws::account scanned{initial, {}, {}}, shared{other_initial, {}, {}};
  lws::db::spend spent{};
  spent.link = {last.id, crypto::rand<crypto::hash>()};
  spent.source = {0, 17};
  spent.image = crypto::rand<crypto::key_image>();
  scanned.add_spend(spent);
  shared.add_spend(spent);
  for (unsigned i = 0; i != 600; ++i)
  {
    lws::db::output output{};
    output.link = {last.id, crypto::rand<crypto::hash>()};
    output.spend_meta.id = {0, 100 + i};
    output.pub = crypto::rand<crypto::public_key>();
    EXPECT(scanned.add_out(output));
  }
  std::vector<crypto::hash> chain{last.hash, crypto::rand<crypto::hash>()};
  std::vector<lws::account> accounts;
  accounts.push_back(scanned.clone());
  accounts.push_back(shared.clone());
  EXPECT(db.update(last.id, epee::to_span(chain), epee::to_span(accounts), {}));
  std::vector<lws::db::subaddress_dict> subs;
  subs.emplace_back(lws::db::major_index(0), lws::db::index_ranges{{{lws::db::minor_index(0), lws::db::minor_index(999)}}});
  EXPECT(db.upsert_subaddresses(initial.id, wallet.address, wallet.view, subs, 2000));
  EXPECT(db.import_request(wallet.address, last.id, {}));
  const auto token = MONERO_UNWRAP(db.prepare_account_delete(wallet.address, wallet.view));
  EXPECT(!MONERO_UNWRAP(db.delete_account(wallet.address, wallet.view, token)));
  // An unknown token cannot report complete while this address still has data.
  EXPECT(!db.delete_account(wallet.address, wallet.view, crypto::rand<crypto::hash>()));
  EXPECT(!MONERO_UNWRAP(db.start_read()).get_account(wallet.address));
  {
    auto reader = MONERO_UNWRAP(db.start_read());
    EXPECT(MONERO_UNWRAP(reader.get_outputs(initial.id)).count() == 345u);
    EXPECT(MONERO_UNWRAP(reader.get_images(spent.source)).count() == 1u);
  }
  EXPECT(db.add_account(wallet.address, wallet.view));
  const auto replacement_id = read_account(db, wallet).id;
  EXPECT(replacement_id > other_initial.id);
  EXPECT(!MONERO_UNWRAP(db.delete_account(wallet.address, wallet.view, token)));
  EXPECT(read_account(db, wallet).id == replacement_id);
  db = reopen(db);
  for (unsigned i = 0; i != 12; ++i) EXPECT(db.cleanup_deleted_accounts());
  {
    auto reader = MONERO_UNWRAP(db.start_read());
    EXPECT(MONERO_UNWRAP(reader.get_outputs(initial.id)).count() == 0u);
    EXPECT(MONERO_UNWRAP(reader.get_spends(initial.id)).count() == 0u);
    EXPECT(MONERO_UNWRAP(reader.get_subaddresses(initial.id)).empty());
    EXPECT(MONERO_UNWRAP(reader.get_spends(other_initial.id)).count() == 1u);
    EXPECT(MONERO_UNWRAP(reader.get_images(spent.source)).count() == 1u);
  }
  const auto other_token = MONERO_UNWRAP(db.prepare_account_delete(other.address, other.view));
  EXPECT(MONERO_UNWRAP(db.delete_account(other.address, other.view, other_token)));
  EXPECT(MONERO_UNWRAP(MONERO_UNWRAP(db.start_read()).get_images(spent.source)).count() == 0u);
  // Old scan and subaddress RPCs cannot write rows for the deleted registration.
  EXPECT(read_account(db, wallet).id > other_initial.id);
  EXPECT(!db.upsert_subaddresses(initial.id, wallet.address, wallet.view, subs, 2000));
  const auto updated = db.update(last.id, epee::to_span(chain), {&scanned, 1}, {});
  EXPECT(updated);
  EXPECT(updated->accounts_updated == 0u);
  EXPECT(MONERO_UNWRAP(MONERO_UNWRAP(db.start_read()).get_outputs(initial.id)).count() == 0u);
  EXPECT(!db.delete_account(wallet.address, wallet.view, token));
}

LWS_CASE("wallet deletion is serialized with in-flight scan commits")
{
  lws::db::test::cleanup_db cleanup;
  auto db = lws::db::test::get_fresh_db();
  wallet_keys wallet;
  EXPECT(db.add_account(wallet.address, wallet.view));
  const auto initial = read_account(db, wallet);
  const auto last = MONERO_UNWRAP(MONERO_UNWRAP(db.start_read()).get_last_block());
  lws::account scanned{initial, {}, {}};
  lws::db::output output{};
  output.link = {last.id, crypto::rand<crypto::hash>()};
  output.spend_meta.id = {0, 55};
  output.pub = crypto::rand<crypto::public_key>();
  EXPECT(scanned.add_out(output));
  const auto token = MONERO_UNWRAP(db.prepare_account_delete(wallet.address, wallet.view));
  std::vector<crypto::hash> chain{last.hash, crypto::rand<crypto::hash>()};
  auto writer = db.clone();
  bool update_ok = false;
  std::thread scan([&] { update_ok = bool(writer.update(last.id, epee::to_span(chain), {&scanned, 1}, {})); });
  const auto deleted = db.delete_account(wallet.address, wallet.view, token);
  scan.join();
  EXPECT(update_ok);
  EXPECT(deleted);
  EXPECT(MONERO_UNWRAP(db.delete_account(wallet.address, wallet.view, token)));
  EXPECT(!MONERO_UNWRAP(db.start_read()).get_account(wallet.address));
  EXPECT(MONERO_UNWRAP(MONERO_UNWRAP(db.start_read()).get_outputs(initial.id)).count() == 0u);
}
