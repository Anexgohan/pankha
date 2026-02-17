
# run from mock agents vm 192.168.100.238 pulls from server 192.168.100.237:
```bash
cd /root/anex/proxmox/misc-scripts/pankha-mock-agents-swarm/ && \
rsync \
  -ahv -HKSX --info=progress2,stats2,flist2 --inplace --no-whole-file --mkpath --delete --no-i-r \
  root@192.168.100.237:/root/anex/dev/pankha-dev/agents/clients/mock-agents/pankha-mock-agents-swarm/ \
  /root/anex/proxmox/misc-scripts/pankha-mock-agents-swarm/ \
  --exclude='data/' --exclude='runtime/' --exclude='venv/' && \
cd /root/anex/proxmox/misc-scripts/pankha-mock-agents-swarm/ && \
  ./mock-agents --restart
```

----------
# to netcup-vps1 from server 192.168.100.237:
```bash
cd /root/anex/dev/pankha-dev/agents/clients/mock-agents/pankha-mock-agents-swarm/ && \
rsync \
  -ahv -HKSX --info=progress2,stats2,flist2 --inplace --no-whole-file --mkpath --delete --no-i-r \
  /root/anex/dev/pankha-dev/agents/clients/mock-agents/pankha-mock-agents-swarm/ \
  root@netcup-vps1:/home/anex/pankha/pankha-mock-agents-swarm/ \
  --exclude='data/' --exclude='runtime/' --exclude='venv/' && \
cd /home/anex/pankha/pankha-mock-agents-swarm/ && \
  ./mock-agents --restart
```

> **NOTE:**
> --exclude='data/' --exclude='runtime/' --exclude='venv/' 
> is used to exclude the data, runtime and venv directories from the rsync command. Otherwise settings and runtime data will be overwritten.