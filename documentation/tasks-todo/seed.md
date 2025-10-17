Read the following:
    - /root/anex/dev/pankha-dev/CLAUDE.md
    - /root/anex/dev/pankha-dev/README.md
    - find and read all .md files under 
        "/root/anex/dev/pankha-dev/documentation/" directory one by one with a 1 second pause, 
        Excluding the excluded paths listed below under "exclude reading from"
exclude reading from: 
    - /root/anex/dev/pankha-dev/documentation/tasks-todo/
    - /root/anex/dev/pankha-dev/documentation/tasks-todo/seed.md

Always ask me to run the following commands when requuired:
    - "npm run dev"
    - "docker compose down"
    - "docker compose up -d"
    - "docker compose build --no-cache"
    - "cd /root/anex/dev/pankha-dev && docker compose down && docker compose build --no-cache && docker compose up -d"
    - "docker compose up -d --build"
    - "cd /root/anex/proxmox/misc-scripts/pankha-fan-control && ./pankha-agent.sh start|stop|restart|setup"
---
start 5 mock clients with "manage-mock-agents.sh" command on development, called client-01 and so on and start the container and the backend and the frontend and any other relevant services
---
read pankha-dev/documentation/tasks-todo/task_04_linux_client-agent.md and summerize what you are not allowed to do on the client side
read pankha-dev/documentation/tasks-todo/task_05_agent-server-communication.md also
---
build the docker compose and start the Development npm run dev environment on the development server

make sure not to hard code anything so our agent should be able to work on most linux/windows systems with differing hardware. Pankha is designed to be hardware-agnostic.
---
i have manually started "cd /root/anex/dev/pankha-dev && npm run dev"
---
do you know how to start the remote linux agent, also what are the conditions you have to follow when ssh to remote agent? 
---

Think step-by-step
to plan and execute this task:  
    - the dashboard gui shuold be centered with dynamic margins on left and right side
    - start working on task_03_dashboard_features.md and deploy to development

---------------------------------------
# linux client-agent DEVELOPMENT WORKFLOW :  
1. **Local Development**: Work on files in `/root/anex/dev/pankha-dev/agents/clients/linux/debian/`
2. **File Sync**: Copy files to client system for testing: `scp -r pankha-agent/ root@192.168.100.199:/path/`
3. **Backup Management**: Use `pankha-agent/backups/` directory for all file backups
4. **Testing**: Deploy and test on client system, iterate as needed

----------------------------------------
1. Hiding a sensor in the "Temperrature Sensors" section should also hide it from being available as selection in the "Control Sensor" dropdown in the "Fans" section.
2. 
3. 

complete 1. then ask me to move to 2. and then 3.
-----------------------------------------
instead of "Backend Controller update rate" tooltip make it a label with the dropdown under it, 
Label: 
System Responsiveness (CPU Load)
and have the tooltip read 
Tooltip:
How quickly the system calculates temperature changes and fan speeds, reads agents, send commands to agents.
Lower values are CPU intensive.
-----------------------------------------

Read the following:
    - /root/anex/dev/pankha-dev/CLAUDE.md
    - /root/anex/dev/pankha-dev/README.md
Any other relevant documentation for this project when needed, you can find and read the .md files under
    - "/root/anex/dev/pankha-dev/documentation/" directory. 
            Excluding the excluded paths listed below under "exclude reading from"
exclude reading from:
    - /root/anex/dev/pankha-dev/documentation/tasks-todo/
    - /root/anex/dev/pankha-dev/documentation/tasks-todo/seed.md

Always ask me to run the following commands when requuired:
    - "npm run dev"
    - "docker compose down"
    - "docker compose up -d"
    - "docker compose build --no-cache"
    - "cd /root/anex/dev/pankha-dev && docker compose down && docker compose build --no-cache && docker compose up -d"
    - "docker compose up -d --build"
    - "cd /root/anex/proxmox/misc-scripts/pankha-fan-control && ./pankha-agent.sh start|stop|restart|setup"

make sure not to hard code anything so our agent should be able to work on most linux/windows systems with differing hardware. Pankha is designed to be hardware-agnostic.

on the dashboard "Fan Profiles" page I created a way to to import or export the created fan profiles. But the export does not work, fix it.

----
# current layout is:
Development repo (private) linked to https://github.com/Anexgohan/pankha-dev
./pankha-dev/ 
all code changes are done here first, and then after testing and verification we will port the changes to the production repo below for release.
uses in compose
```yml
services:
  pankha-app:
    build:
      context: .
      dockerfile: docker/Dockerfile
  ...
```

Public repo (public) linked to https://github.com/Anexgohan/pankha
./pankha/
this repo will be shared and open sourced for the community. docker image
uses in compose
```yml
services:
  pankha-app:
    image: anexgohan/pankha:latest
  ...
```