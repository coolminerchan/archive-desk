# Capture guide

## Account capture

1. Run the application and select the one-click capture button. Allow elevation for live recording. Select the original client executable or Steam shortcut if discovery needs a path.
2. Wait until recording is ready. The client opens after the recorder starts. If it is already running, sign out and sign in again to capture the account response.
3. Browse characters, outfit categories, inventory pages, storage, weapons, armor, and posters. Equipped items alone do not establish complete equipment coverage.
4. Open the world map and each unlocked region's exploration pages. Visit the relevant scenes and wait for objects to load. Open collection and moon pages as needed. A single scene response does not establish coverage of other regions.
5. Visit your own home, presets, furniture, and pets. Walk through the areas you want to preserve. Open mail, friends, achievement groups, archives, and life skills. Gacha history is optional.
6. Exit the client or select stop and save. Wait for analysis to finish. A single identified account produces an account ZIP under Documents. Original recordings stay in the session folder for recovery.

The displayed login UID comes from the account response. Internal role IDs remain separate and are used for data associations. Missing login identifiers are not guessed.

## Visited-home collection

Open the dedicated decoration page and start its recorder. Visit another player's home through the client. Walk through each relevant area and wait for furniture to load before moving on. Each observed owner is listed separately. Private or inaccessible homes cannot be captured through a failed visit.

Export one home or the complete collection. Account records and visited-home layouts remain separate. This module does not import decorations into your own home.

## Own scenes

The own-scenes page reads completed account captures, account ZIPs, and standalone scene archives. Ownership is matched to the account's internal ID, with the recorded public UID used only when the scene has no internal channel ID.

Every distinct snapshot is retained. The table shows the largest recorded snapshot for each scene; snapshots are not merged into a purported final layout. Snapshot summaries include furniture, placed characters, decor, vehicles, chairs, and treasure boxes when present.

A standalone scene archive carries declared ownership metadata. Opening one does not establish a fresh login or create an account backup.

## Life and social records

Open all six profession pages and their respective pictorial pages. Base levels, skills, achievements, and pictorial history counts are separate observations. Viewing one does not establish coverage of the other. No crafting or reward collection is needed.

Open the friends, applications, and blacklist tabs separately. The tool pairs their requests and responses by connection and PacketId. It preserves classifications and original profiles; it does not create accounts, homes, or relationships.

Missing or ambiguous exchanges remain unknown. Existing response-only ZIPs cannot establish a list category from ordering. If the original recording is available, reanalysis can recover captured request evidence. An absent pictorial-history response still needs a supplemental capture of that page.

The account ZIP contains life-social.json and, when recorded, packet-context.json. All snapshots remain separate; the display does not establish their final state.

## Inspection and recovery

ZIP, PCAP, and PCAPNG input is supported. Both standalone decoration packages and account ZIPs containing garden directories can be inspected. Legacy scene indexes are accepted with their original bare SceneData records.

Before an export replaces its destination, the tool checks ZIP contents and ownership, copies into a temporary file, verifies SHA-256, and validates the copy. A failed export preserves the previous destination.

Preflight checks cover recording permissions, component availability, protocol resources, output writability, and free space. The settings page can reopen the last recording for analysis. Error details stay in the local logs directory; diagnostic export uses a restricted field list.

## Updates

Use the settings page to check for updates. Checking at startup is optional. Downloads are accepted only from the configured repository and must pass signature, digest, product, and archive checks.

Update checks and package downloads try GitHub directly first. If the connection fails, stalls, or returns invalid content, the tool tries the built-in GH-Proxy route. The settings page shows the active route. A route that successfully fetched the signed descriptor is preferred for the package download.

Connection waits are limited to 12 seconds, stalled transfers to 20 seconds, and each package attempt to 10 minutes. Switching routes restarts the transfer and verifies its full size and digest. No GitHub token, account archive, or game traffic is sent to the proxy. Both routes require the same release signature.

The verified package is staged before installation. Choose “Update and restart” to close the application and replace the program files in its current directory. The same EXE path and existing shortcuts open the updated version. Capture and analysis must finish before updating.

An independent helper waits for both application processes to exit. Replaced program components are kept in a .capture-backup-* directory. Unrelated files at the installation root, settings, and account archives are retained. If replacement fails, the helper restores the previous components. An interrupted transaction is recovered on the next launch.

When an older updater starts this version from its cache, a matching prepared-update record and the original launch directory allow the new version to finish installation at the original location. A normal launch from an unrelated directory does not trigger this migration.

A private repository or an unpublished release may have no anonymously accessible update. The application does not request or embed a GitHub account token.

## Limits

Only data returned by the client session can be preserved. An empty server response, an unseen category, an unvisited region, and a partially loaded scene are different states. None is presented as proof of complete account coverage.

One recording stops at 448 MiB or 30 minutes. The UI shows recording storage and the active backend. Record another session if needed; retain the original files until the resulting archives have been checked.
