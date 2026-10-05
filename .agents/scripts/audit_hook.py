import sys
import json
import subprocess
import os

def main():
    input_data = sys.stdin.read()
    if not input_data:
        print("{}")
        return

    try:
        payload = json.loads(input_data)
    except json.JSONDecodeError:
        print("{}")
        return
    
    # Change to the workspace root
    workspace_paths = payload.get("workspacePaths", [])
    if workspace_paths:
        os.chdir(workspace_paths[0])
    
    # Check for the audit script staged by the agent
    audit_script = "audit.bat"
    if not os.path.exists(audit_script):
        print("{}")
        return
        
    execution_num = payload.get("executionNum", 1)
    MAX_ITERATIONS = 5
    if execution_num > MAX_ITERATIONS:
        # Prevent infinite loops
        print("{}")
        return
        
    # Run the audit
    result = subprocess.run([audit_script], capture_output=True, text=True, shell=True)
    
    if result.returncode != 0:
        output = {
            "decision": "continue",
            "reason": f"Audit failed (iteration {execution_num}/{MAX_ITERATIONS}). Please fix these issues and stop again:\n\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        }
        print(json.dumps(output))
    else:
        # Success! Clean up the script and allow stop
        try:
            os.remove(audit_script)
        except Exception:
            pass
        print("{}")

if __name__ == "__main__":
    main()
