# PokeMarket Discord Bot

## Included fixes
- Reliable Forum `THREAD_CREATE` handling for auction and buy forums, with starter-message retries and duplicate protection.
- `/auctionpage add` scans existing posts; new posts are processed automatically.
- Auction prices accept common formats including `$`, `R`, `ZAR`, `USD`, `EUR`, and `GBP`.
- Auction listings show detected country and Shipping: National / International when supplied in the post.
- Missing auction requirements now produce an explanation inside the forum post instead of silently doing nothing.
- `/buypagelocate` supports multiple forums without duplicate listing messages.
- `/tlog channel:#ticket-log` stores closed-ticket transcripts as `.txt` files.
- `/quickset` refreshes the TCGdex set list, processes every returned set, and falls back to a set-summary post when card-detail loading fails.
- Japanese/Chinese set posts show the localized set name first and the English counterpart/translation when available.
- `/quickset` orders sets oldest release date to newest.

## TCGdex note
TCGdex is the live source for set data. Japanese and Traditional Chinese are supported by TCGdex; Simplified Chinese availability depends on TCGdex's own dataset coverage.


## Railway environment variables
- `DISCORD_TOKEN` is the preferred Discord bot token variable.
- `DISCORD_BOT_TOKEN` is also accepted for backwards compatibility.
- `PRICECHARTING_API_TOKEN` is optional.
- `OPENAI_API_KEY` is optional for features that use it.

The Discord Gateway now has an explicit WebSocket connection/reconnect implementation, heartbeat handling, sequence tracking, READY handling, and Gateway error/close logging.


## Buy system (current)
Only the `/buy` slash command is registered by this version.

### Multiple buy forums
Each Forum Channel can have its own IN STOCK and SOLD OUT tags:
- `/buy forum add forum:#forum ticket_category:#category`
- After adding, choose that forum's IN STOCK and SOLD OUT tags.
- `/buy forum remove forum:#forum`
- `/buy forum list`
- `/buy configure-tags forum:#forum`
- `/buy setup ticket_category:#category` updates the negotiation ticket category for all configured buy forums.
- `/buy facilitator role:@role`
- `/buy dispute role:@role`
- `/buy list`

New posts in every configured buy forum receive that forum's IN STOCK tag and a separate Buy Now / Negotiate control message.

BUY NOW marks the listing SOLD OUT, removes IN STOCK, disables the control buttons, preserves the original forum starter message, removes other post messages, and posts the SOLD message.

Manual application of a configured SOLD OUT tag is also detected from `THREAD_UPDATE` and runs the same cleanup without deleting the original forum starter message.

Negotiation tickets keep the exact originating listing ID and forum ID. Facilitator, Dispute, and Finish Transaction buttons operate on that exact listing; Finish Transaction marks only that listing SOLD OUT and disables its Finish button.
