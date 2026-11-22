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


# P2

1. file diff panel showed no diff,
2. no project skills, 
3. file diff before finishing, 
4. prompt expand should expand scrollable be default, 
5. the process details was not collapsed when there wasn’t a final report, 



# P3

1. sometimes the safari just pop out notification but there's no task;
2. safari local notice/ntfy settings page layout and buttons
3. the subagent session should indent, 
4. terminal bottom, 
5. test background sub agent, 
6. change the notification sound!
7. terminal support fzf shortcuts;
8. add a similar theme to gpt;
9. add background support; when stop also stop background,
10. use the global pi,
11. didn’t have good worktree display support ; 


# prompts





# task1

pic1: /Users/lynx/Documents/github/sux-mac/clipboard-history/2026-11-22/2026-11-22-images/20261122090852.png

in the pic1,  when i click the `BLOCKERS.md`, the `Edited files` section showed there was `+21 -2`, but there's no diff on the right side diff panel, it just directly showed the file content; we need a real diff panel there


# task2

pic2: /Users/lynx/Documents/github/sux-mac/clipboard-history/2026-11-22/2026-11-22-images/20261122091558.png
pic3: /Users/lynx/Documents/github/sux-mac/clipboard-history/2026-11-22/2026-11-22-images/20261122091501.png


in the pic2, on the Settings-Skills page, we need the `project level skills` just like the `project level MCP` in the pic3; you can use the `project level mcp` as a reference to implement a similar one, there should be something like a `Turn on in this project` button to add a specific skill as a project skill;


# task3

pic4: /Users/lynx/Documents/github/sux-mac/clipboard-history/2026-11-22/2026-11-22-images/20261122093954.png

now when the task is finished, there would be `edited files` block in the pic4 , but what i want is that once the ai agent modified any file while ai agent is working on the task but not complete yet, there should be a collapsed `edited files` block above the `composer`, and the `edited files` block should be dynamic, it would automatically change its file list and count to fit what ai agent modify; and when the task is finish, there should be only one `edited files` block


# task4

pic5: /Users/lynx/Documents/github/sux-mac/clipboard-history/2026-11-22/2026-11-22-images/20261122094715.png
pic6: /Users/lynx/Documents/github/sux-mac/clipboard-history/2026-11-22/2026-11-22-images/20261122095025.png

current behavior: in the pic5/6 only when i click the `Expand` button in the prompt block, the prompt block would be scrollable, but although i expand it, the prompt block height is still too small.

expected behavior: the prompt block should be scrollable without clicking the scrollable, when i click the `Expand` button it should expand to the full height to fit the whole prompt, when i click `collapse` button, it should recover


# task5

current behavior: when i open a stopped task or a stopped session, then i  scroll up,  the `process details` block would automatically expand; and when there wasn’t a final report, the `process details` block would be expanded by default;

expected behavior: 
1. when i open a stopped task or a stopped session: the `process details` and `compaction` block should be always collapsed by default, they should never expand before i manually click it to expand; 
2. when i open a running session: all the blocks (exclude the final report) should be collapsed to `process details` except for the recent 8 blocks(the recent 8 blocks should be collapsed to themselves including the `compaction` block), when the task stops, all the block (exclude the final report) should be collapsed to `process details`
