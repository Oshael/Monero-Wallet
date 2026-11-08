// Disposable persistence probe. All arguments must refer to the guarded test mount.
#include "db/storage.h"
#include "config.h"
#include "db/data.h"
#include "db/account.h"
#include "common/expect.h"
#include "crypto/crypto.h"
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

int main(int argc, char** argv)
{
  try
  {
    lws::config::network = cryptonote::STAGENET;
    if (argc != 4) throw std::runtime_error{"Expected phase, database and fixture paths"};
    const std::string phase{argv[1]};
    lws::db::account_address address{};
    crypto::secret_key view{};
    if (phase == "create")
    {
      crypto::generate_keys(address.spend_public, view);
      crypto::generate_keys(address.view_public, view);
      std::ofstream fixture{argv[3], std::ios::binary | std::ios::out | std::ios::trunc};
      fixture.write(reinterpret_cast<const char*>(&address), sizeof(address));
      fixture.write(reinterpret_cast<const char*>(&view), sizeof(view));
      fixture.close();
      if (!fixture) throw std::runtime_error{"Cannot write disposable fixture"};
      auto db = lws::db::storage::open(argv[2], 5);
      MONERO_UNWRAP(db.add_account(address, view));
      const auto token = MONERO_UNWRAP(db.prepare_account_delete(address, view));
      // The outstanding authorization must also survive a filesystem remount.
      std::ofstream authorization{std::string{argv[3]} + ".token", std::ios::binary};
      authorization.write(reinterpret_cast<const char*>(&token), sizeof(token));
      authorization.close();
      if (!authorization) throw std::runtime_error{"Cannot write disposable authorization"};
    }
    else if (phase == "recover-delete")
    {
      std::ifstream fixture{argv[3], std::ios::binary};
      fixture.read(reinterpret_cast<char*>(&address), sizeof(address));
      fixture.read(reinterpret_cast<char*>(&view), sizeof(view));
      if (!fixture) throw std::runtime_error{"Cannot read disposable fixture"};
      crypto::hash token{};
      std::ifstream authorization{std::string{argv[3]} + ".token", std::ios::binary};
      authorization.read(reinterpret_cast<char*>(&token), sizeof(token));
      if (!authorization) throw std::runtime_error{"Cannot read disposable authorization"};
      auto db = lws::db::storage::open(argv[2], 5);
      {
        auto reader = MONERO_UNWRAP(db.start_read());
        const auto account = MONERO_UNWRAP(reader.get_account(address));
        if (account.second.id != lws::db::account_id(1)) throw std::runtime_error{"Unexpected recovered registration"};
      }
      if (!MONERO_UNWRAP(db.delete_account(address, view, token))) throw std::runtime_error{"Unexpected unfinished cleanup"};
      if (MONERO_UNWRAP(db.start_read()).get_account(address)) throw std::runtime_error{"Deleted account remains accessible"};
      MONERO_UNWRAP(db.add_account(address, view));
      if (db.delete_account(address, view, token)) throw std::runtime_error{"Old authorization deleted replacement"};
      const auto replacement = MONERO_UNWRAP(db.prepare_account_delete(address, view));
      if (!MONERO_UNWRAP(db.delete_account(address, view, replacement))) throw std::runtime_error{"Replacement cleanup incomplete"};
    }
    else throw std::runtime_error{"Unknown persistence phase"};
    std::cout << "Persistence phase passed\n";
    return 0;
  }
  catch (...)
  {
    // Never serialize keys, credentials or underlying request data.
    std::cerr << "Persistence phase failed\n";
    return 1;
  }
}
