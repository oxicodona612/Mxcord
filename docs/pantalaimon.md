# Encrypted rooms with pantalaimon

Discord's JavaScript engine cannot run Matrix's encryption libraries, so Mxcord relies on [pantalaimon](https://github.com/matrix-org/pantalaimon), a proxy that handles end-to-end encryption on behalf of a client. Run pantalaimon in front of your homeserver and set Mxcord's homeserver URL to pantalaimon's address.

## Installation

```sh
python3 -m venv ~/pantalaimon/venv
~/pantalaimon/venv/bin/pip install pantalaimon
```

On some platforms, such as arm64, `python-olm` has no prebuilt wheel and fails to build with recent CMake versions. Build it from source:

```sh
~/pantalaimon/venv/bin/pip install cmake cffi future
export CMAKE_POLICY_VERSION_MINIMUM=3.5
curl -LO https://files.pythonhosted.org/packages/b8/eb/23ca73cbdc8c7466a774e515dfd917d9fbe747c1257059246fdc63093f04/python-olm-3.2.16.tar.gz
tar xzf python-olm-3.2.16.tar.gz
~/pantalaimon/venv/bin/pip install --no-build-isolation ./python-olm-3.2.16
~/pantalaimon/venv/bin/pip install pantalaimon
```

On Python 3.12 and later, also install:

```sh
~/pantalaimon/venv/bin/pip install "future==1.0.0" legacy-cgi
```

## Configuration

`~/.config/pantalaimon/pantalaimon.conf`:

```ini
[Default]
LogLevel = Info
SSL = False

[myserver]
Homeserver = http://localhost:8008
ListenAddress = 127.0.0.1
ListenPort = 8009
SSL = False
UseKeyring = False
IgnoreVerification = True
```

`IgnoreVerification` is required because Mxcord has no device verification interface.

Run pantalaimon as a service and expose it over HTTPS through a reverse proxy. With Caddy:

```
matrix-e2ee.example.com {
    reverse_proxy 127.0.0.1:8009
}
```

## Conduit, conduwuit and continuwuity

pantalaimon 0.10.5 depends on matrix-nio 0.20.2, which rejects some valid responses from Conduit-based homeservers. Symptoms include messages that other clients cannot decrypt, sends failing with `500 M_UNKNOWN`, and `MembersSyncError` in the log. Apply these changes to the installed packages:

1. `nio/schemas.py`
   - In the keys query and keys claim schemas, remove `"failures"` from `required`.
   - In the joined members schema, change `"required": ["display_name"]` to `"required": []`.
   - In the devices schema, require only `"device_id"`.
2. `nio/responses.py`: replace both occurrences of `parsed_dict["failures"]` with `parsed_dict.get("failures", {})`.
3. `pantalaimon/client.py`, in `start_loop`: set `next_batch = None`. These servers return an empty response to a full-state sync with a `since` token, which leaves pantalaimon without room state.
4. Optional, `pantalaimon/daemon.py`: lower `decryption_timeout` from 10 to 3 to shorten startup when the history contains undecryptable messages.

Synapse does not need these changes.

## Older messages

pantalaimon can only decrypt messages sent after its session was created. To read older messages, export your room keys from Element (**Settings > Security & Privacy > Export E2E room keys**) and import them with `panctl import-keys`.
