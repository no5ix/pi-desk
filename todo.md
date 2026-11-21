# P0

1. fix : when clicking the `add project` icon in the pic1, it should show the native macos finder for me to pick a folder, just like pic2
2. show current branch on the conversation header, it should be placed on the right to the project name; for example: `[folder icon] sadoyo   [branch icon] main`, the folder icon should reuse the project icon on the project section on the left side panel; the branch icon should use a new one;
3. when i start the pi-agent-desktop with `npm run dev` or `npm start`, the Tailscale should automatically start and then automatically run the command `tailscale serve --bg 30141`, and the start log should print the `tailscale serve status` result with green color;
4. add a local safari notification configuration on the Settings-General page, when i enable it and task is finished, pi-agent-desktop should pop out a local safari notification, the format should be:
   1. the title should be the Session's name
   2. the content format is "The task lasted `*h*m*s`, started at hh:mm:ss, and ended at hh:mm:ss. This notification pops up at hh:mm:ss.", for example "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at 10:22:47."


# P1

 
## extra 6 tasks

 firstly, there are 6 extra tasks below, don't ask me any questions for the task below, you can make your decisions. implement them in the project `/Users/lynx/Documents/github/pi-desk-worktrees/pi-desk-branch-tailscale-safari` on the `feat/pi-desk-branch-tailscale-safari` branch: 
 
1. implement a NTFY notification configuration on the Settings-General page to notify a finished task, the default `Server url` should be `https://ntfy.sh`,  so i can configure the `Topic name`, and there should also be a `Send Test Notice` button for me to test; on the Settings-General page, when i enable it and task is finished, pi-agent-desktop should pop out a local safari notification, the format should be:
   1. the title should be the Session's name
   2. the content format is "The task lasted `*h*m*s`, started at hh:mm:ss, and ended at hh:mm:ss. This notification pops up at hh:mm:ss.", for example "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at 10:22:47."
2. show how long the current task spend, the total time should be displayed at the bottom next to the `copy` button after the current task finish; for example, if a session's last prompt was sent at 23:15:27, and the task was finished at 23:46:37, so it should display like "Copy 0h31m10s      Nov 21 11:46PM", the copy button and `Nov 21 11:46PM` should keep their current position;
3. when clicking the project name on the left side panel, we should add animation to projects expansion/collapsing
4. sometimes when i open a session, it didn't show the correct content, it didn't show the final report, but when i refresh the webpage once, sometimes it would show the final report correctly
5. the `compaction` card should be also collapsed by default when i open a session; and i should be able to click the compaction card's header to expand it;
6. when expanding the `Process details`, the thinking card should be collapsed by default;

## test and fix bugs
secondly, test all the previous 4tasks and these new 6 tasks in the project /Users/lynx/Documents/github/pi-desk-worktrees/pi-desk-branch-tailscale-safari on the feat/pi-desk-branch-tailscale-safari branch and fix all the issues

## Autonomous Execution and Context Management

You are an autonomous senior software engineer. Your
responsibility is to complete the entire assigned task,
not merely investigate it or produce a progress report.

### 1. Never stop because of context pressure

- Never voluntarily terminate a task merely because you
  estimate that your remaining context is low.
- Do not interpret context pressure as task completion.
- Use Pi's native automatic compaction mechanism.
- Before context becomes critically low, update the
  persistent task checkpoint.
- After compaction, reconstruct the task state from
  the compaction summary and checkpoint files.
- Resume from the exact next unfinished step.
- Do not repeat completed work unnecessarily.

### 2. Maintain continuous execution

- Work through all remaining phases independently.
- Make reasonable engineering decisions without waiting
  for user confirmation.
- If one approach fails, investigate alternatives.
- If a test fails, diagnose and fix it rather than
  merely documenting the failure.
- Do not stop after producing an analysis or plan.
- Do not stop after completing only the easiest phases.

### 3. Use durable checkpoints

Maintain:
- PLAN.md
- PROGRESS.md
- DECISIONS.md
- BLOCKERS.md

Update PROGRESS.md after every significant milestone.

Record:
- Completed tasks
- Current implementation state
- Failed attempts and their causes
- Outstanding work
- Exact next actions
- Verification results

### 4. Handle blockers intelligently

Do not classify low context, a failed approach, or a
temporary tool error as a reason to abandon the task.

Try alternative implementations and verification methods.

Only stop when:
- The task is genuinely complete;
- An external dependency makes further progress impossible;
- A security or safety restriction prevents continuation;
- Or an explicit user decision is genuinely required.

When blocked, complete all independent work first.

### 5. Completion requirements

Do not declare success based on partial test results.

Run the relevant verification suite, inspect the final
Git diff, and verify the working tree.

Continue until all achievable acceptance criteria are met.

Do not substitute a progress report for implementation.

The task is complete only when its acceptance criteria
have been satisfied and verified.

Your goal is to finish the task, even if it requires
multiple context compactions and many execution cycles.
 thirdly, 

# P2

4. change the notification sound!
5. terminal support fzf shortcuts;
6. add a similar theme to gpt;
1. add background support; when stop also stop background,
3. use the global pi,
