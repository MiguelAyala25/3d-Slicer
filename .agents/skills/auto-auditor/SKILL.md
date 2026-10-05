---
name: auto-auditor
description: >-
  Use this skill when the user asks for an autonomous implementation and audit loop.
  It configures the system to repeatedly audit and fix your work until it passes.
---
# Auto-Auditor Skill

You have been asked to perform a task using an autonomous audit/fix loop.

## Instructions

1. **Stage the Audit:** Create a file named `audit.bat` in the workspace root. Write the exact terminal command(s) needed to run the requested audit (e.g., `pytest`, `npm test`, `flake8`, etc.) into this file.
2. **Implement:** Write the code to fulfill the user's requested task.
3. **Stop:** Once your implementation is complete, simply **stop** your execution.
4. **DO NOT run the audit script yourself.** The system's Lifecycle Hook will automatically intercept your stop, run `audit.bat` silently, and feed the results back to you if it fails.
5. **Fix:** If you are woken back up with a system message containing audit failures, analyze the output, fix the code, and attempt to stop again.
