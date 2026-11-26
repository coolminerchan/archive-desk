# archive-desk v0.7.0

Added life and social capture evidence.

- Life base records, pictorial history counts, and classified social lists now have separate quality items and browsing instructions.
- Pictorial requests and responses are matched by TCP connection and PacketId, preserving the requested profession.
- Friend, application, and blacklist responses retain their request category. Repeated snapshots remain separate.
- Account ZIPs include packet-context.json and life-social.json for inspection and import integration.
- Older response-only ZIPs retain unknown classifications. Reanalyzing an original PCAP can recover classifications when the request evidence is present.
- Unmatched, duplicate, failed, and incomplete exchanges remain unclassified. Missing history is not estimated from achievements or inventory.

Open each of the six profession pages and its pictorial page, then open friends, applications, and the blacklist. No crafting, reward collection, or relationship changes are required for capture.

The collector preserves evidence. It does not create local accounts, homes, or social relationships. See [the format notes](docs/capture-life-social-format.md) for importer requirements.

The Windows package contains 使用说明.txt and Capture-guide.md. Credits and repository links are listed in the README.
