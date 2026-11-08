// Project integration of LWS data with the existing Monero wallet engine.
// Cryptographic operations below use the pinned Monero implementation.
#include "wallet2.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "rapidjson/document.h"
#include <algorithm>
#include <chrono>
#include <limits>
#include <set>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

namespace tools {
namespace {
using value = rapidjson::Value;

void require_light(bool condition) {
  if (!condition) throw std::runtime_error("Invalid light wallet data");
}

void light_wallet_turn(std::chrono::steady_clock::time_point deadline) {
  require_light(std::chrono::steady_clock::now() < deadline);
#ifdef __EMSCRIPTEN__
  emscripten_sleep(0);
#endif
}

const value& field(const value& object, const char* name) {
  require_light(object.IsObject());
  const auto found = object.FindMember(name);
  require_light(found != object.MemberEnd());
  return found->value;
}

uint64_t integer(const value& input) {
  if (input.IsUint64()) return input.GetUint64();
  require_light(input.IsString() && input.GetStringLength() > 0 && input.GetStringLength() <= 20);
  uint64_t result = 0;
  for (size_t i = 0; i < input.GetStringLength(); ++i) {
    const char digit = input.GetString()[i];
    require_light(digit >= '0' && digit <= '9');
    const uint64_t next = static_cast<uint64_t>(digit - '0');
    require_light(result <= (std::numeric_limits<uint64_t>::max() - next) / 10);
    result = result * 10 + next;
  }
  return result;
}

bool flag(const value& object, const char* name) {
  const auto& input = field(object, name);
  require_light(input.IsBool());
  return input.GetBool();
}

template<typename T> T binary(const value& input) {
  T result{};
  require_light(input.IsString() && input.GetStringLength() == sizeof(T) * 2);
  require_light(epee::string_tools::hex_to_pod(std::string(input.GetString(), input.GetStringLength()), result));
  return result;
}

uint64_t scan_height(const value& input) {
  const uint64_t height = integer(input);
  require_light(height > 0 && height <= 1000000000);
  return height;
}

void add_balance(uint64_t& total, uint64_t amount) {
  require_light(total <= std::numeric_limits<uint64_t>::max() - amount);
  total += amount;
}

wallet2::unconfirmed_transfer_details detach_confirmation(
    const wallet2::confirmed_transfer_details& confirmed) {
  wallet2::unconfirmed_transfer_details pending{};
  pending.m_tx = confirmed.m_tx;
  pending.m_amount_in = confirmed.m_amount_in;
  pending.m_amount_out = confirmed.m_amount_out;
  pending.m_change = confirmed.m_change;
  pending.m_sent_time = confirmed.m_timestamp;
  pending.m_dests = confirmed.m_dests;
  pending.m_payment_id = confirmed.m_payment_id;
  pending.m_state = wallet2::unconfirmed_transfer_details::pending;
  pending.m_timestamp = confirmed.m_timestamp;
  pending.m_subaddr_account = confirmed.m_subaddr_account;
  pending.m_subaddr_indices = confirmed.m_subaddr_indices;
  pending.m_rings = confirmed.m_rings;
  return pending;
}

void decode_commitment(wallet2::transfer_details& output, const value& input,
    const crypto::key_derivation& derivation, bool coinbase) {
  const auto packed = input.FindMember("rct");
  output.m_mask = rct::identity();
  output.m_rct = packed != input.MemberEnd();
  if (!output.m_rct) return;
  require_light(packed->value.IsString() && packed->value.GetStringLength() == 192);
  std::string bytes;
  require_light(epee::string_tools::parse_hexstr_to_binbuff(
      std::string(packed->value.GetString(), 192), bytes) && bytes.size() == 96);
  if (coinbase) return; // Checked against the node's real output commitment before import.
  rct::key commitment{};
  rct::ecdhTuple encrypted{};
  memcpy(commitment.bytes, bytes.data(), 32);
  memcpy(encrypted.mask.bytes, bytes.data() + 32, 32);
  memcpy(encrypted.amount.bytes, bytes.data() + 64, 32);
  crypto::secret_key scalar;
  crypto::derivation_to_scalar(derivation, output.m_internal_output_index, scalar);
  rct::ecdhDecode(encrypted, rct::sk2rct(scalar), false);
  require_light(rct::h2d(encrypted.amount) == output.m_amount);
  require_light(rct::commit(output.m_amount, encrypted.mask) == commitment);
  output.m_mask = encrypted.mask;
}

wallet2::transfer_details decode_output(const value& input, uint64_t height,
    const cryptonote::account_keys& keys,
    const std::unordered_map<crypto::public_key, cryptonote::subaddress_index>& subaddresses,
    hw::device& device) {
  wallet2::transfer_details output{};
  output.m_amount = integer(field(input, "amount"));
  output.m_internal_output_index = integer(field(input, "index"));
  output.m_global_output_index = integer(field(input, "global_index"));
  output.m_block_height = integer(field(input, "height"));
  require_light(output.m_amount > 0 && output.m_internal_output_index <= 65535 && output.m_block_height < height);
  output.m_txid = binary<crypto::hash>(field(input, "tx_hash"));
  const auto tx_public = binary<crypto::public_key>(field(input, "tx_pub_key"));
  const auto public_key = binary<crypto::public_key>(field(input, "public_key"));
  require_light(crypto::check_key(public_key) && crypto::check_key(tx_public));
  crypto::key_derivation derivation;
  require_light(crypto::generate_key_derivation(tx_public, keys.m_view_secret_key, derivation));
  const auto received = cryptonote::is_out_to_acc_precomp(subaddresses, public_key,
      derivation, {}, output.m_internal_output_index, device);
  require_light(bool(received));
  const auto& recipient = field(input, "recipient");
  require_light(integer(field(recipient, "major")) == received->index.major &&
      integer(field(recipient, "minor")) == received->index.minor);
  output.m_subaddr_index = received->index;
  require_light(output.m_subaddr_index.major == 0 && output.m_subaddr_index.minor < 1000);
  const bool coinbase = flag(input, "coinbase");
  decode_commitment(output, input, derivation, coinbase);
  cryptonote::keypair ephemeral;
  require_light(cryptonote::generate_key_image_helper(keys, subaddresses, public_key,
      tx_public, {}, output.m_internal_output_index, ephemeral, output.m_key_image, device));
  require_light(ephemeral.pub == public_key);
  output.m_key_image_known = true;
  output.m_pk_index = 0;
  output.m_tx.version = output.m_rct ? 2 : 1;
  output.m_tx.unlock_time = integer(field(input, "unlock_time"));
  if (coinbase) output.m_tx.vin.push_back(cryptonote::txin_gen{static_cast<size_t>(output.m_block_height)});
  output.m_tx.vout.resize(output.m_internal_output_index + 1);
  output.m_tx.vout[output.m_internal_output_index] = cryptonote::tx_out{
      output.m_rct && !coinbase ? uint64_t(0) : output.m_amount, cryptonote::txout_to_key{public_key}};
  require_light(cryptonote::add_tx_pub_key_to_extra(output.m_tx, tx_public));
  const auto& candidates = field(input, "spend_key_images");
  require_light(candidates.IsArray() && candidates.Size() <= 10000);
  for (const auto& candidate : candidates.GetArray()) {
    const auto image = binary<crypto::key_image>(candidate);
    if (image == output.m_key_image) output.m_spent = true;
  }
  return output;
}

wallet2::transfer_container stable_output_indices(const wallet2::transfer_container& previous,
    wallet2::transfer_container& imported) {
  require_light(previous.size() <= 10000);
  uint64_t allocated = 0;
  for (const auto& output : previous) {
    require_light(allocated + output.m_tx.vout.size() <= 1000000);
    allocated += output.m_tx.vout.size();
  }
  auto stable = previous;
  std::unordered_map<crypto::public_key, size_t> positions;
  for (size_t index = 0; index < stable.size(); ++index) {
    auto& output = stable[index];
    require_light(positions.emplace(output.get_public_key(), index).second);
    // Retire missing fork outputs without reusing an index referenced by signed data.
    output.m_spent = true;
    output.m_spent_height = std::numeric_limits<uint64_t>::max();
  }
  for (auto& output : imported) {
    const auto found = positions.find(output.get_public_key());
    if (found == positions.end()) {
      require_light(stable.size() < 10000 && allocated + output.m_tx.vout.size() <= 1000000);
      allocated += output.m_tx.vout.size();
      positions.emplace(output.get_public_key(), stable.size());
      stable.push_back(std::move(output));
      continue;
    }
    auto& existing = stable[found->second];
    require_light(existing.m_txid == output.m_txid && existing.m_key_image == output.m_key_image &&
        existing.m_internal_output_index == output.m_internal_output_index);
    allocated -= existing.m_tx.vout.size();
    require_light(allocated + output.m_tx.vout.size() <= 1000000);
    allocated += output.m_tx.vout.size();
    output.m_frozen = existing.m_frozen;
    output.m_uses = std::move(existing.m_uses);
    existing = std::move(output);
  }
  return stable;
}
} // namespace

void wallet2::verify_missing_light_wallet_outputs(const transfer_container& incoming,
    std::chrono::steady_clock::time_point deadline) {
  using namespace cryptonote;
  std::unordered_set<crypto::public_key> present;
  for (const auto& output : incoming) present.insert(output.get_public_key());
  std::set<crypto::hash> missing;
  for (const auto& previous : m_transfers) {
    if (previous.m_spent_height == std::numeric_limits<uint64_t>::max()) continue;
    if (!present.count(previous.get_public_key())) missing.insert(previous.m_txid);
  }
  for (auto next = missing.begin(); next != missing.end();) {
    light_wallet_turn(deadline);
    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
        deadline - std::chrono::steady_clock::now());
    require_light(remaining.count() > 0);
    COMMAND_RPC_GET_TRANSACTIONS::request request{};
    request.prune = true;
    std::set<crypto::hash> expected;
    for (size_t count = 0; count < 20 && next != missing.end(); ++count, ++next) {
      expected.insert(*next);
      request.txs_hashes.push_back(epee::string_tools::pod_to_hex(*next));
    }
    COMMAND_RPC_GET_TRANSACTIONS::response response{};
    {
      const boost::lock_guard<boost::recursive_mutex> lock{m_daemon_rpc_mutex};
      const bool success = epee::net_utils::invoke_http_json("/gettransactions", request,
          response, *m_http_client, std::min(remaining, std::chrono::milliseconds(15000)));
      require_light(success && response.status == CORE_RPC_STATUS_OK);
    }
    require_light(response.txs.size() + response.missed_tx.size() == request.txs_hashes.size());
    for (const auto& entry : response.txs) {
      // A still-confirmed parent cannot disappear merely because the scanner omitted it.
      require_light(entry.in_pool);
      require_light(entry.as_hex.size() + entry.pruned_as_hex.size() + entry.prunable_as_hex.size() <= 8 * 1024 * 1024);
      transaction decoded;
      crypto::hash hash;
      require_light(parse_light_wallet_transaction(entry, decoded, hash) && expected.erase(hash) == 1);
    }
    for (const auto& encoded : response.missed_tx) {
      crypto::hash hash;
      require_light(encoded.size() == 64 && epee::string_tools::hex_to_pod(encoded, hash));
      require_light(expected.erase(hash) == 1);
    }
    require_light(expected.empty());
  }
}

void wallet2::verify_light_wallet_outputs(const transfer_container& outputs,
    std::chrono::steady_clock::time_point deadline) {
  using namespace cryptonote;
  for (size_t offset = 0; offset < outputs.size(); offset += 100) {
    light_wallet_turn(deadline);
    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
        deadline - std::chrono::steady_clock::now());
    require_light(remaining.count() > 0);
    COMMAND_RPC_GET_OUTPUTS_BIN::request request{};
    request.get_txid = true;
    const size_t end = std::min(outputs.size(), offset + 100);
    for (size_t index = offset; index < end; ++index) {
      const auto& output = outputs[index];
      request.outputs.push_back(get_outputs_out{
          output.m_rct ? uint64_t(0) : output.m_amount, output.m_global_output_index});
    }
    COMMAND_RPC_GET_OUTPUTS_BIN::response response{};
    {
      const boost::lock_guard<boost::recursive_mutex> lock{m_daemon_rpc_mutex};
      const bool success = epee::net_utils::invoke_http_bin("/get_outs.bin", request,
          response, *m_http_client, std::min(remaining, std::chrono::milliseconds(15000)));
      require_light(success && response.status == CORE_RPC_STATUS_OK);
    }
    require_light(response.outs.size() == end - offset);
    for (size_t index = offset; index < end; ++index) {
      const auto& output = outputs[index];
      const auto& actual = response.outs[index - offset];
      const auto commitment = output.m_rct ? rct::commit(output.m_amount, output.m_mask) :
          rct::zeroCommit(output.m_amount);
      require_light(actual.key == output.get_public_key() && actual.mask == commitment &&
          actual.height == output.m_block_height && actual.txid == output.m_txid);
    }
  }
}

std::map<crypto::hash, wallet2::confirmed_transfer_details> wallet2::verify_light_wallet_transactions(transfer_container& outputs, payment_container& payments,
    const std::map<crypto::hash, uint64_t>& confirmations, std::chrono::steady_clock::time_point deadline) {
  using namespace cryptonote;
  auto required = confirmations;
  for (const auto& output : outputs) {
    const auto added = required.emplace(output.m_txid, output.m_block_height);
    require_light(added.second || added.first->second == output.m_block_height);
  }
  std::map<crypto::hash, transaction_prefix> prefixes;
  std::map<crypto::hash, uint64_t> fees;
  std::map<crypto::hash, uint64_t> timestamps;
  size_t transaction_bytes = 0;
  for (auto next = required.begin(); next != required.end();) {
    light_wallet_turn(deadline);
    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
        deadline - std::chrono::steady_clock::now());
    require_light(remaining.count() > 0);
    COMMAND_RPC_GET_TRANSACTIONS::request request{};
    request.prune = true;
    for (size_t count = 0; count < 20 && next != required.end(); ++count, ++next)
      request.txs_hashes.push_back(epee::string_tools::pod_to_hex(next->first));
    COMMAND_RPC_GET_TRANSACTIONS::response response{};
    {
      const boost::lock_guard<boost::recursive_mutex> lock{m_daemon_rpc_mutex};
      const bool success = epee::net_utils::invoke_http_json("/gettransactions", request,
          response, *m_http_client, std::min(remaining, std::chrono::milliseconds(15000)));
      require_light(success && response.status == CORE_RPC_STATUS_OK);
    }
    require_light(response.txs.size() == request.txs_hashes.size());
    for (const auto& entry : response.txs) {
      const size_t bytes = entry.as_hex.size() + entry.pruned_as_hex.size() + entry.prunable_as_hex.size();
      require_light(bytes <= 8 * 1024 * 1024 && transaction_bytes + bytes <= 64 * 1024 * 1024);
      transaction_bytes += bytes;
      transaction decoded;
      crypto::hash hash;
      require_light(parse_light_wallet_transaction(entry, decoded, hash));
      const auto expected = required.find(hash);
      require_light(expected != required.end() && !entry.in_pool && entry.block_height == expected->second);
      require_light(decoded.vout.size() <= 65536);
      require_light(prefixes.emplace(hash, decoded).second);
      fees.emplace(hash, decoded.is_coinbase() ? 0 : get_tx_fee(decoded));
      timestamps.emplace(hash, entry.block_timestamp);
    }
  }
  require_light(prefixes.size() == required.size());
  uint64_t allocated_outputs = 0;
  for (auto& output : outputs) {
    const auto& actual = prefixes.at(output.m_txid);
    require_light(allocated_outputs + actual.vout.size() <= 1000000);
    allocated_outputs += actual.vout.size();
    const bool coinbase = actual.vin.size() == 1 && boost::get<txin_gen>(&actual.vin[0]);
    require_light(output.m_tx.unlock_time == actual.unlock_time);
    require_light((output.m_tx.vin.size() == 1) == coinbase);
    require_light(output.m_internal_output_index < actual.vout.size());
    crypto::public_key public_key;
    const auto& actual_output = actual.vout[output.m_internal_output_index];
    require_light(get_output_public_key(actual_output, public_key) && public_key == output.get_public_key());
    require_light(output.m_tx.vout[output.m_internal_output_index].amount == actual_output.amount);
    output.m_tx = actual;
  }
  for (auto& payment : payments) payment.second.m_fee = fees.at(payment.second.m_tx_hash);
  // Discover real spends locally. Candidate rings and key images are never sent to the scanner.
  std::unordered_map<crypto::key_image, size_t> key_images;
  std::map<crypto::hash, uint64_t> received;
  for (size_t index = 0; index < outputs.size(); ++index) {
    key_images.emplace(outputs[index].m_key_image, index);
    add_balance(received[outputs[index].m_txid], outputs[index].m_amount);
  }
  std::vector<bool> spent(outputs.size(), false);
  std::map<crypto::hash, confirmed_transfer_details> recovered;
  for (const auto& entry : prefixes) {
    confirmed_transfer_details transfer;
    for (const auto& input : entry.second.vin) {
      const auto* coin = boost::get<txin_to_key>(&input);
      if (!coin) continue;
      const auto found = key_images.find(coin->k_image);
      if (found == key_images.end()) continue;
      auto& output = outputs[found->second];
      require_light(!spent[found->second]);
      spent[found->second] = true;
      output.m_spent_height = required.at(entry.first);
      add_balance(transfer.m_amount_in, output.m_amount);
      transfer.m_subaddr_indices.insert(output.m_subaddr_index.minor);
      transfer.m_rings.emplace_back(coin->k_image, coin->key_offsets);
    }
    if (transfer.m_amount_in == 0) continue;
    const uint64_t fee = fees.at(entry.first);
    require_light(fee <= transfer.m_amount_in);
    transfer.m_tx = entry.second;
    transfer.m_amount_out = transfer.m_amount_in - fee;
    const auto change = received.find(entry.first);
    transfer.m_change = change == received.end() ? 0 : change->second;
    require_light(transfer.m_change <= transfer.m_amount_out);
    transfer.m_block_height = required.at(entry.first);
    transfer.m_timestamp = timestamps.at(entry.first);
    transfer.m_unlock_time = entry.second.unlock_time;
    transfer.m_subaddr_account = 0;
    recovered.emplace(entry.first, std::move(transfer));
  }
  for (size_t index = 0; index < outputs.size(); ++index)
    require_light(outputs[index].m_spent == spent[index]);
  return recovered;
}

void wallet2::import_light_wallet_data(const std::string& json) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(20);
  require_light(!m_watch_only && !m_multisig && !m_light_wallet);
  require_light(m_transfers.size() <= 10000);
  require_light(json.size() <= 64 * 1024 * 1024);
  rapidjson::Document input;
  input.Parse(json.data(), json.size());
  require_light(!input.HasParseError() && input.IsObject());
  if (m_has_ever_refreshed_from_node) require_light(flag(input, "adopt_legacy"));
  const uint64_t height = scan_height(field(input, "height"));
  const auto& source = field(input, "outputs");
  require_light(source.IsArray() && source.Size() <= 10000);
  transfer_container incoming;
  incoming.reserve(source.Size());
  decltype(m_key_images) key_images;
  decltype(m_pub_keys) pub_keys;
  payment_container payments;
  std::set<std::pair<uint64_t, uint64_t>> positions;
  auto subaddresses = m_subaddresses;
  auto labels = m_subaddress_labels;
  if (labels.empty()) labels.emplace_back(1);
  uint64_t allocated_outputs = 0;
  for (const auto& entry : source.GetArray()) {
    if (incoming.size() % 50 == 0) light_wallet_turn(deadline);
    const uint64_t index = integer(field(entry, "index"));
    require_light(index <= 65535 && allocated_outputs + index + 1 <= 1000000);
    allocated_outputs += index + 1;
    const auto& recipient = field(entry, "recipient");
    require_light(integer(field(recipient, "major")) == 0);
    const uint64_t minor = integer(field(recipient, "minor"));
    require_light(minor < 1000);
    const cryptonote::subaddress_index subaddress{0, static_cast<uint32_t>(minor)};
    subaddresses[get_subaddress_spend_public_key(subaddress)] = subaddress;
    auto output = decode_output(entry, height, m_account.get_keys(), subaddresses, m_account.get_device());
    if (labels[0].size() <= minor) labels[0].resize(minor + 1);
    require_light(positions.emplace(output.m_rct ? 0 : output.m_amount, output.m_global_output_index).second);
    require_light(key_images.emplace(output.m_key_image, incoming.size()).second);
    require_light(pub_keys.emplace(output.get_public_key(), incoming.size()).second);
    payment_details payment{};
    payment.m_tx_hash = output.m_txid;
    payment.m_amount = output.m_amount;
    payment.m_amounts.push_back(output.m_amount);
    payment.m_block_height = output.m_block_height;
    payment.m_unlock_time = output.m_tx.unlock_time;
    payment.m_timestamp = integer(field(entry, "timestamp"));
    payment.m_coinbase = flag(entry, "coinbase");
    payment.m_subaddr_index = output.m_subaddr_index;
    payments.emplace(crypto::null_hash, std::move(payment));
    incoming.push_back(std::move(output));
  }
  auto unconfirmed = m_unconfirmed_txs;
  auto pool_payments = m_unconfirmed_payments;
  auto confirmed = m_confirmed_txs;
  const auto& confirmations = field(input, "confirmed");
  require_light(confirmations.IsArray() && confirmations.Size() <= 10000);
  std::map<crypto::hash, uint64_t> confirmed_heights;
  for (const auto& entry : confirmations.GetArray()) {
    const auto hash = binary<crypto::hash>(field(entry, "hash"));
    const uint64_t block = integer(field(entry, "height"));
    require_light(block < height);
    require_light(confirmed_heights.emplace(hash, block).second);
  }
  for (auto previous = confirmed.begin(); previous != confirmed.end();) {
    const auto current = confirmed_heights.find(previous->first);
    if (current != confirmed_heights.end()) {
      previous->second.m_block_height = current->second;
      ++previous;
      continue;
    }
    require_light(unconfirmed.emplace(previous->first, detach_confirmation(previous->second)).second);
    previous = confirmed.erase(previous);
  }
  for (const auto& confirmation : confirmed_heights) {
    const auto& hash = confirmation.first;
    const auto pending = unconfirmed.find(hash);
    if (pending == unconfirmed.end()) continue;
    confirmed[hash] = confirmed_transfer_details(pending->second, confirmation.second);
    unconfirmed.erase(pending);
  }
  verify_missing_light_wallet_outputs(incoming, deadline);
  verify_light_wallet_outputs(incoming, deadline);
  const auto recovered = verify_light_wallet_transactions(incoming, payments, confirmed_heights, deadline);
  // Legacy pool receipts must not be counted again after their verified confirmation.
  for (auto payment = pool_payments.begin(); payment != pool_payments.end();) {
    if (confirmed_heights.count(payment->second.m_pd.m_tx_hash)) payment = pool_payments.erase(payment);
    else ++payment;
  }
  for (const auto& entry : recovered) {
    const auto previous = confirmed.find(entry.first);
    if (previous == confirmed.end()) confirmed.emplace(entry);
    else {
      require_light(previous->second.m_amount_in == entry.second.m_amount_in &&
          previous->second.m_amount_out == entry.second.m_amount_out);
      previous->second.m_change = entry.second.m_change;
    }
  }
  // Native wallet2 excludes same-account change from incoming payments.
  for (auto payment = payments.begin(); payment != payments.end();) {
    const auto& hash = payment->second.m_tx_hash;
    require_light(unconfirmed.count(hash) == 0);
    if (confirmed.count(hash)) payment = payments.erase(payment);
    else ++payment;
  }
  // Retain locally known pending spends even if a scanner has not seen them yet.
  for (const auto& pending : unconfirmed) {
    if (pending.second.m_state == unconfirmed_transfer_details::failed) continue;
    for (const auto& input : pending.second.m_tx.vin) {
      const auto* spent = boost::get<cryptonote::txin_to_key>(&input);
      if (!spent) continue;
      const auto found = key_images.find(spent->k_image);
      if (found != key_images.end()) incoming[found->second].m_spent = true;
    }
  }
  uint64_t balance = 0;
  for (const auto& output : incoming) {
    if (!output.m_spent) add_balance(balance, output.m_amount);
  }
  for (const auto& pending : unconfirmed) {
    if (pending.second.m_state == unconfirmed_transfer_details::failed) continue;
    add_balance(balance, pending.second.m_change);
    for (const auto& destination : pending.second.m_dests) {
      if (get_subaddress_index(destination.addr)) add_balance(balance, destination.amount);
    }
  }
  for (const auto& payment : pool_payments) add_balance(balance, payment.second.m_pd.m_amount);
  auto stable = stable_output_indices(m_transfers, incoming);
  key_images.clear();
  pub_keys.clear();
  for (size_t index = 0; index < stable.size(); ++index) {
    require_light(key_images.emplace(stable[index].m_key_image, index).second);
    require_light(pub_keys.emplace(stable[index].get_public_key(), index).second);
  }
  // All parsing, cryptographic checks and allocations precede this state change.
  m_transfers.swap(stable);
  m_key_images.swap(key_images);
  m_pub_keys.swap(pub_keys);
  m_payments.swap(payments);
  m_unconfirmed_txs.swap(unconfirmed);
  m_unconfirmed_payments.swap(pool_payments);
  m_confirmed_txs.swap(confirmed);
  m_subaddresses.swap(subaddresses);
  m_subaddress_labels.swap(labels);
  m_has_ever_refreshed_from_node = false;
  m_light_wallet_scanned_block_height = height;
  m_light_wallet_blockchain_height = height;
}

void wallet2::restore_light_wallet_height(uint64_t height) {
  require_light(!m_light_wallet && !m_has_ever_refreshed_from_node && height > 0 && height <= 1000000000);
  for (const auto& output : m_transfers) require_light(output.m_block_height < height ||
      (output.m_spent && output.m_spent_height == std::numeric_limits<uint64_t>::max()));
  m_light_wallet_scanned_block_height = height;
  m_light_wallet_blockchain_height = height;
}
} // namespace tools
