export class ChangelogEntry {
    version = "";
    date = "";
    changes = "";
}
export const CHANGELOG = [
    {
        version: "Fork 1.4",
        date: "2026-07-03",
        changes: "- Added Energy Thresholds (Advanced Automation): skip prioritized Tasks that cost more than a percentage of your max Energy. Six Task categories (new Perk you can finish this run, new Perk out of reach, awards an Item, progression, unlocks a Task, everything else), each with its own threshold, a toggle (a disabled category is exempt and always runs), and a metric switch: /lvl judges Energy per skill level earned, /rep judges the rep's total Energy. Progression defaults to /rep so a high skill level can't make travelling look worthless and strand the run<br>"
            + "- Optional End Run When All Skipped: when every remaining prioritized Task is over its threshold, trigger the Energy Reset instead of idling<br>"
            + "- Added Auto Dreamcatcher (Advanced Automation): automatically use a held Dreamcatcher before a Task rep that would consume at least a set percentage of your current Energy (default 25%), so the duplication fires late in the run when the Item haul is near its biggest<br>"
            + "- Added Auto Magic Ring (Advanced Automation): the Tasks you completed last run are ranked by how many extra skill levels a Magic Ring would have earned; the best ones (as many as you have Rings for, counting Rings found mid-run) each get a Ring automatically when they start this run<br>"
            + "- Added Auto-Fill Priorities (Advanced Automation): one click fills every reached Zone's automation priorities with a sensible order — Item Tasks, Task-unlockers, Perk Tasks (cheapest first), the rest by skill levels per Energy, Mandatory/Prestige and Travel last<br>"
            + "- Added Auto-Prioritize (Advanced Automation): autopilot for priorities — re-runs Auto-Fill automatically at every Energy Reset and Prestige, on Task unlock, and on Zone entry. Mutually exclusive with Queue Cycle<br>"
    },
    {
        version: "Fork 1.3",
        date: "2026-06-09",
        changes: "- Added Auto Bottled Lightning (Advanced Automation): automatically spends a held Bottled Lightning on a Boss rep you couldn't otherwise afford. With Auto Scroll of Haste also on, Lightning is applied first<br>"
            + "- Bosses too strong to attempt now unlock at 10x your current Energy (up from 5x) once you've obtained Bottled Lightning<br>"
            + "- A queue's repeat count can now be 0, which skips that queue in the cycle<br>"
            + "- Auto Scroll of Haste now also fires on Tasks you start manually, not just automated ones<br>"
            + "- Mastery of Time no longer auto-completes scheduled artifact Tasks or injected Tasks, and queued Artifact effects are no longer wasted on them<br>"
            + "- Fixed popups (Divinity, Settings, etc.) getting cut off on short screens, such as a phone in landscape<br>"
    },
    {
        version: "Fork 1.2",
        date: "2026-06-06",
        changes: "- Added Queue Cycling: save multiple automation plans (\"queues\") and rotate through them, one or more per Energy Reset. Each queue has its own Task priorities, scheduled artifact Tasks, Item auto-use mode, repeat count, and optional name<br>"
            + "- Per-queue Item auto-use: All, None, or Exclude (use everything except a chosen list). You can exclude Items you don't currently hold<br>"
            + "- Reorder, rename, and add/remove queues; collapse the queue list; advance the cycle manually<br>"
            + "- Added Priority Edit Mode: a frozen mode for arranging automation priorities, with navigation between Zones you've reached<br>"
    },
    {
        version: "Fork 1.1",
        date: "2026-06-06",
        changes: "- Added Artifact Tasks: schedule \"Use &lt;Artifact&gt;\" as a Task at a point in a Zone, so automation can use Artifacts for you. Add or remove them via the Artifacts section of the Task list<br>"
            + "- Added an option to only run artifact Tasks on Item (Auto Use Items) cycles, so they're skipped on banking cycles<br>"
    },
    {
        version: "Fork 1.0",
        date: "2026-06-04",
        changes: "- These \"Fork\" versions are additions in the Archipelago-CC fork, listed separately from the upstream versions below<br>"
            + "- Added a Game Mods section in Settings: Award Spark on Discovery (with a configurable fraction), Force Automation, Auto-Continue Energy Reset, and Suppress Prestige Popup<br>"
            + "- Added an Advanced Automation panel: Resume on Reset, Auto Scroll of Haste (auto-spend Scrolls on reps you couldn't otherwise afford), Auto Use Cycle (alternate banking and spending Items across Energy Resets), and Use Free Items<br>"
    },
    {
        version: "1.1.1",
        date: "2026-04-12",
        changes: "- Fixed Minor Time Compression's single-tick Task effect not working<br>"
            + "- The Zone name now has a tooltip which shows the highest Zone (30)<br>"
    },
    {
        version: "1.1.0",
        date: "2026-04-10",
        changes: "- Mastery of Time's Task skipping no longer applies to Zones you've not set to be automated (in case you want to do things like use a Magic Ring<br>"
            + "- The Energy bar tooltip now shows ticks and Energy use per second<br>"
            + "- Reduced the cost of Crafting Breakthrough by a third<br>"
            + "- Made Z25 a bit easier<br>"
            + "- Improved the XP of the training Tasks in Z30<br>"
            + "- Added setting for what to do when the next Task can't be started when using Task Automation (E.G., due to a Boss being too strong). You can now choose between pausing automation, and skipping the Task<br>"
            + "- Fixed Mastery of Time being affected by active Artifacts<br>"
            + "- The Used Items notification now gets consolidated if you use more than 3 Items in short succession. Artifacts are unaffected<br>"
            + "- The Tasks skipped notification now gets consolidated if you skip Tasks in multiple Zones in short succession<br>"
    },
    {
        version: "1.0.0",
        date: "2026-03-13",
        changes: "- The game is now content complete<br>"
            + "- Added zones Z28, Z29, and Z30, including:<br>"
            + "-- 5 new Prestige upgrades<br>"
            + "-- 4 new repeatable Prestige upgrades<br>"
            + "-- 5 new Items<br>"
            + "-- 6 new Perks<br>"
            + "- Added Z26 and Z27 bosses and boss Tasks<br>"
    },
    {
        version: "0.5.0",
        date: "2026-02-27",
        changes: "- Added zones Z26 and Z27, including:<br>"
            + "-- 3 new Prestige upgrades<br>"
            + "-- 4 new repeatable Prestige upgrades<br>"
            + "-- 2 new Items<br>"
            + "-- 2 new Perks<br>"
            + "- Made Defy the Gods task about 30% easier<br>"
            + "- Made Divine Knowledge's cost scale slightly faster<br>"
            + "- Made Permanent Automation and Divine Inspiration have a small cost<br>"
            + "- The Z25 Prestige task is now 4 reps instead of 5, slightly higher cost per rep<br>"
            + "- Fixed Bottled Lightning showing up in the tooltips of Tasks it doesn't apply to<br>"
            + "- Fixed Bottled Lightning queued stacks not getting zeroed on Energy reset<br>"
            + "- Mastery of Time can now skip zones on prestige<br>"
            + "- Fixed numbers getting sometimes shown as 1000k and similar rather than 1.00M<br>"
            + "- The Energized prestige upgrade now also boosts Energetic Memory's bonus a little<br>"
            + "- Made Z23 post-boss task cheaper<br>"
            + "- Rebalanced the mandatory tasks in Z25<br>"
            + "- You now get the option to Prestige when you reach the end of content<br>"
            + "- Divine Lightning current effect now has three significant figures in the tooltip<br>"
            + "- Added a Task after the Z24 Boss<br>"
    },
    {
        version: "0.4.0",
        date: "2026-02-06",
        changes: "- Added zones Z21 through Z25, including:<br>"
            + "-- A new Artifact<br>"
            + "-- 5 new Items<br>"
            + "-- 4 new Bosses<br>"
            + "-- 6 new Perks<br>"
            + "- Added a new Prestige repeatable upgrade<br>"
            + "- Added two new Prestige unlockables<br>"
            + "- Added a 3rd mandatory Task to Zone 20<br>"
            + "- Made the bosses in Zone 19 and 20 harder<br>"
            + "- Made the post-boss Task in Zone 19 harder<br>"
            + "- Renamed Firemaking Kit to Camping Equipment and changed its icon<br>"
            + "- Updated the tooltip for the Settings Menu button<br>"
            + "- The Divine Lightning tooltip now tells you its effect in the highest Zone you've reached<br>"
            + "- Made Divine Lightning scale faster in cost<br>"
            + "- Power gain now gets formated as `1.23k` and such once it passes 1k<br>"
            + "- Fixed the Prestige Task button not being highlighted in one case where it should be<br>"
            + "- Buffed Divine Speed slightly<br>"
            + "- Fixed Task Automation not applying the effects of Haste and similar<br>"
            + "- Boss Tasks disabled due to costing too much Energy now have a 🚫 icon<br>"
            + "- Fixed buttons getting highlighted in some cases when selected<br>"
    },
    {
        version: "0.3.6",
        date: "2026-01-28",
        changes: "- Minor Time Compression's tooltip now does the math for how big the effect currently is<br>"
            + "- Fixed the stylesheet being broken<br>"
    },
    {
        version: "0.3.5",
        date: "2026-01-28",
        changes: "- Fixed the tooltip of Energy Items not updating immediately when you upgrade Divine Appetite<br>"
            + "- Fixed Energy Items energy gain not being truncated at and above Divine Appetite level 7 (showing E.G., 12.00000000002)<br>"
            + "- Added favicon (browser tab icon)<br>"
            + "- Made Transcendant Aptitude cheaper, but made the cost scale up faster<br>"
            + "- Setting the automation target Zone to the current Zone or lower now stops ongoing automation<br>"
            + "- The To Zone automation button is now disabled if the target Zone isn't higher than the current Zone<br>"
    },
    {
        version: "0.3.4",
        date: "2026-01-27",
        changes: "- Renamed the 'All' task automation mode to 'Until Zone'. You can now specify a Zone that it'll stop when you get to. If you're already in or past that Zone when enabling Until Zone, it'll just do whatever Zone you're in, like Current Zone automation<br>"
            + "- Added a mention to the Energy tooltip that drain is proportional to the time spent on a Task, and goes up a little with each Zone<br>"
            + "- The Reflections on the Journey Perk's tooltip now states the highest Zone reached, and the effect in the current Zone<br>"
            + "- The stats screen now shows your Highest Zone reached, and fully completed. If you've Prestiged, it also shows the highest in any Prestige. Note that this number will initially be wrong in saves before this update, since this info was not tracked until now<br>"
            + "- The Prestige button no longer shows Divine Spark gain if you can't Prestige yet, instead showing just your current amount. Still clickable<br>"
            + "- The Prestige button now glows when you reach a new highest Zone, since that at least doubles the Divine Spark gain<br>"
    },
    {
        version: "0.3.3",
        date: "2026-01-25",
        changes: "- Fixed the Unified Theory of Magic not always updating the Highest Zone fully completed<br>"
            + "- Made it extra clear that Minor Time Compression's Zone skipping gives all the benefits manually doing the Zone would've<br>"
    },
    {
        version: "0.3.2",
        date: "2026-01-22",
        changes: "- Added a setting that makes tooltips only show while CTRL is held (off by default)<br>"
            + "- Fixed the Repeat Tasks and Manual Use Items tooltips not updating on click<br>"
    },
    {
        version: "0.3.1",
        date: "2026-01-22",
        changes: "- Fixed the Automation mode not getting highlighted any more<br>"
            + "- Fixed the 2026 changelog entries saying 2025<br>"
    },
    {
        version: "0.3.0",
        date: "2026-01-20",
        changes: "- Buffed Magical Essence a bit<br>"
            + "- Rebalanced Divine Spark gain entirely, as well as Prestige upgrade costs<br>"
            + "- Reduced the effect of Major Time Compression on Task real-time speed<br>"
            + "- Rebalanced Tasks past Zone 15<br>"
            + "- Rebalanced Prestige rewards and upgrade costs<br>"
            + "- Fixed the Dream Prism perk stating its effect twice<br>"
            + "- Now showing highest Zone fully completed in the Unified Theory of Magic Perk<br>"
            + "- Added a Save Reset button in the Settings<br>"
            + "- Fixed running out of Energy while viewing info from the last Run not giving the Run Over screen<br>"
            + "- Boss Task automations now get removed on Prestige, since you generally only want to deal with them later in the Prestige run<br>"
            + "- Added hotkeys for Automation and Task Repetition<br>"
            + "- Tasks giving an Artifact you've never gotten before now glow<br>"
            + "- If you get far enough without beating any Bosses, the game now reminds you of their existence<br>"
    },
    {
        version: "0.2.1",
        date: "2026-01-19",
        changes: "- Clarified a couple of tooltips<br>"
            + "- Reduced the cost of some of the first Prestige upgrades<br>"
            + "- Made the Fortitude task in Z15 give a bit more XP<br>"
            + "- Made Magical Roots give twice as much Fortitude<br>"
    },
    {
        version: "0.2.0",
        date: "2026-01-19",
        changes: "- Rebalanced the game up to Zone 15<br>"
            + "- Merged the Druid skill into the Magic skill<br>"
            + "- Removed the Survival skill. Replaced with Search, Fortitude, Crafting, or nothing depending on the Task<br>"
            + "- You no longer keep half your Items on Energy reset; this is unlocked later instead<br>"
            + "- If you don't have enough Energy to fully complete a Task, it'll now show the Skill Gains as a range (from how much you'd gain using your current Energy, to fully completing)<br>"
            + "- Increased the Magic Ring boost from 3x to 5x<br>"
            + "- Rebalanced some Items<br>"
            + "- Once keeping some Items on reset is unlocked, the Energy reset lets you decide whether to auto-use Items or not<br>"
            + "- Added Credits section<br>"
            + "- Fixed the Perks Skill bonuses breakdown saying 'Item(s)' rather than 'Perk(s)<br>"
            + "- Fixed the Fully Attuned unlockable referring to the Divine Knowledge unlockable by the wrong name<br>"
            + "- Made the Changelog box wider<br>"
            + "- Fixed the Items Skill bonus breakdown showing all bonuses as 100 percentage points higher than reality<br>"
            + "- If the player doesn't figure out prep runs themselves, a hint gets shown a while after unlocking keeping some Items on death<br>"
    },
    {
        version: "0.1.3",
        date: "2025-09-22",
        changes: "- Added changelog<br>"
            + "- Split Items into two categories; normal Items and Artifacts<br>"
            + "- Split out Skill Gains in the Task tooltip from Rewards<br>"
            + "- Stopped showing Completions in the Task tooltip of single-rep Tasks<br>"
            + "- Stopped showing XP Mult in the Task tooltip, as it just caused confusion<br>"
            + "- Fixed two Perks starting their effect twice<br>"
            + "- Added number postfixes beyond T; all the way up To Dc (though currently higher than Qi does not occur)<br>"
            + "- The Items and Perks info tooltips now show all the active Skill bonuses provided<br>"
    },
    {
        version: "0.1.2",
        date: "2025-09-21",
        changes: "- Improved tooltip contrast<br>"
            + "- Added hint about right-clicking to use all items<br>"
            + "- Added vague hint about push runs<br>"
            + "- Moved the automation unlock from Z10 to Z4<br>"
            + "- Moved Attunement from Z8 to Z10<br>"
            + "- Fixed minor incorrect XP calculation after Major Time Compression Perk is unlocked"
    },
    {
        version: "0.1.1",
        date: "2025-09-19",
        changes: "- Sped up progression in Zones 2 and 7 a little<br>"
            + "- Softened the language on the Energy Reset screen<br>"
            + "- Increased size of the button to exit the Energy Reset screen"
    },
    {
        version: "0.1.0",
        date: "2025-09-19",
        changes: "First public release of the game",
    },
];
//# sourceMappingURL=changelog.js.map