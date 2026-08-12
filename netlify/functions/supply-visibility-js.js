// ============================================================
//  supply-visibility-js.js   ·   VERSION: svjs4  (2026-08-12)
//  svjs4: THE SUPPLY-SIDE "WHO CAN FIND ME" PANEL IS GONE TOO. This file
//         now injects NOTHING. It is kept as a served stub rather than
//         deleted because head code carries a loader for it, and a loader
//         pointing at a 404 is a console error on every dashboard load for
//         every supply-side member. Remove the loader first, then this.
//  svjs3: the "Find housing providers" entry card was removed.
//  Serves TWO dashboard injections, both on /account/home:
//    1. Supply-side "Who can find me" panel  (svis4-remote)
//       - landlord / PM / realtor only
//    2. "Find housing providers" entry card  (fpc1)
//       - EVERY member type, links to /find-providers
//
//  svjs2 adds (2). Without it /find-providers is unreachable unless
//  a member types the URL. Note it needed NO head-code change: the
//  loader in w98 already fires on /account/home for all member types,
//  so shipping a dashboard card is now a one-function deploy.
//  That is the payoff of the Netlify-served pattern (Bible v35).
//
//  Served from Netlify because BD strips every backslash from the
//  head-code field and mangles quoting. Head code carries only a
//  6-line loader. NEVER move this back inline.
//  Live at: /.netlify/functions/supply-visibility-js
// ============================================================

const JS = `/* ------------------------------------------------------------
   SUPPLY-SIDE "WHO CAN FIND ME" PANEL (svis4-remote) — REMOVED in svjs4.

   Every toggle on it controlled a capability that no longer exists, and
   the copy had gone from merely useless to actively wrong. "Let renters
   find you and reach out about your listings" with a yellow warning
   saying "with this off, renters cannot find your profile" implies that
   with it ON they can. They cannot, either way: w186 empties the renter
   side, rs3 closes the search function to every member-facing caller, and
   no member finds another member on Renters.com in any direction now.
   A consent control for something that cannot happen is worse than no
   control - it tells a landlord they are making a choice that has no
   effect, on the one surface where being straight with people matters.

   NOTHING IS DELETED. The tags (6-10) are untouched, visibility.js still
   writes the findable index, and the whole block is in git history.
   Restoring the panel means restoring this block AND reopening rs3.
   ------------------------------------------------------------ */

/* ------------------------------------------------------------
   FIND PROVIDERS ENTRY CARD (fpc1) — REMOVED in svjs3.

   The card read "Browse landlords, property managers and realtors
   who chose to be found by renters." Nobody chose that any more:
   w186 emptied the renter visibility panel and its save writes all
   four audience tags FALSE, and rs3 closed renter-search to every
   member-facing caller. The card was an entry point to a capability
   that no longer exists, on a page it could not reach.

   NOT DELETED, REMOVED. The whole block is preserved in git history
   and /find-providers still resolves - it is simply unlinked, the
   same treatment the listing pages got. Restoring it means restoring
   this block AND reopening rs3, in that order; the card alone would
   render a page that returns an empty set.
   ------------------------------------------------------------ */

`;

exports.handler = async function () {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JS,
  };
};
