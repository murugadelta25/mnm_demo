# Check status
sudo systemctl status titan-backend titan-frontend

# Restart after code changes
sudo systemctl restart titan-backend titan-frontend

# View live logs
sudo journalctl -u titan-backend -f
sudo journalctl -u titan-frontend -f

# Stop temporarily
sudo systemctl stop titan-backend titan-frontend

# Disable auto-start on boot
sudo systemctl disable titan-backend titan-frontend

# sudo systemctl restart titan-backend

sudo systemctl restart titan-backend


--to use in the terminal:
Remove the services, use only run.sh

sudo systemctl stop titan-backend titan-frontend
sudo systemctl disable titan-backend titan-frontend
sudo rm /etc/systemd/system/titan-backend.service /etc/systemd/system/titan-frontend.service
sudo systemctl daemon-reload