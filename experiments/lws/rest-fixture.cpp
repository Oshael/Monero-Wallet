// Test-only HTTP fixture: the real pinned REST/database modules, no blockchain
// scanner, no spend authority, no public listener and no data outside tmpfs.
#include "config.h"
#include "db/storage.h"
#include "rest_server.h"
#include "rpc/client.h"
#include <atomic>
#include <chrono>
#include <csignal>
#include <thread>
#include <iostream>
#include <sys/statfs.h>

namespace { volatile std::sig_atomic_t stopped = 0; void stop(int) { stopped = 1; } }

int main(int argc, char** argv)
{
  try
  {
    if (argc != 2) return 1;
    struct statfs filesystem{};
    if (statfs(argv[1], &filesystem) || filesystem.f_type != 0x01021994) return 1;
    lws::config::network = cryptonote::STAGENET;
    auto disk = lws::db::storage::open(argv[1], 5);
    auto context = lws::rpc::context::make("inproc://wallet-browser-fixture", {}, {}, {}, std::chrono::minutes{0}, false, false);
    std::vector<std::string> addresses{"http://127.0.0.1:38084"};
    lws::rest_server::configuration configuration{};
    configuration.feed_timeout = std::chrono::seconds{10};
    configuration.threads = 1;
    configuration.max_subaddresses = 2000;
    configuration.webhook_verify = epee::net_utils::ssl_verification_t::none;
    configuration.auto_accept_creation = true;
    configuration.auto_accept_import = true;
    lws::rest_server server{
      epee::to_span(addresses), {}, disk.clone(), MONERO_UNWRAP(context.connect()), nullptr, configuration
    };
    std::signal(SIGTERM, stop);
    std::signal(SIGINT, stop);
    std::cout << "Disposable stagenet REST fixture ready" << std::endl;
    while (!stopped) std::this_thread::sleep_for(std::chrono::milliseconds{100});
    return 0;
  }
  catch (...)
  {
    std::cerr << "Disposable REST fixture failed" << std::endl;
    return 1;
  }
}
