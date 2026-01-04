# Comprehensive Emoji Test Script for Pankha Windows Agent
# Run this in the same terminal to see which emojis render correctly

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "     COMPREHENSIVE EMOJI RENDER TEST    " -ForegroundColor Cyan
Write-Host "========================================`n"

# Helper function
function Show-EmojiCategory {
    param([string]$Title, [string]$Color, [string[]]$Emojis)
    Write-Host "--- $Title ---" -ForegroundColor $Color
    foreach ($e in $Emojis) { Write-Host "  $e" }
    Write-Host ""
}

# ==================== STATUS & INDICATORS ====================
Show-EmojiCategory "STATUS INDICATORS" "Green" @(
    "✅  Checkmark (success, connected)",
    "✓   Simple check",
    "❌  Red X (error, failed)", 
    "✗   Simple X",
    "⚠️  Warning triangle",
    "⛔  No entry",
    "🛑  Stop sign",
    "🚫  Prohibited",
    "❗  Exclamation",
    "❓  Question",
    "💡  Light bulb (idea/tip)",
    "🔔  Bell (notification)",
    "🔕  Bell off",
    "📢  Megaphone",
    "📣  Cheering megaphone"
)

# ==================== CIRCLES & SHAPES ====================
Show-EmojiCategory "CIRCLES & SHAPES" "Yellow" @(
    "🔴  Red circle",
    "🟠  Orange circle",
    "🟡  Yellow circle",
    "🟢  Green circle",
    "🔵  Blue circle",
    "🟣  Purple circle",
    "⚫  Black circle",
    "⚪  White circle",
    "🟤  Brown circle",
    "●   Filled circle",
    "○   Empty circle",
    "◉   Fisheye",
    "◎   Bullseye",
    "■   Filled square",
    "□   Empty square",
    "▪   Small filled square",
    "▫   Small empty square",
    "◆   Filled diamond",
    "◇   Empty diamond",
    "▲   Triangle up",
    "▼   Triangle down",
    "►   Triangle right",
    "◄   Triangle left"
)

# ==================== ARROWS ====================
Show-EmojiCategory "ARROWS" "Magenta" @(
    "→   Right arrow",
    "←   Left arrow",
    "↑   Up arrow",
    "↓   Down arrow",
    "↔   Left-right arrow",
    "↕   Up-down arrow",
    "↗   Northeast arrow",
    "↘   Southeast arrow",
    "↙   Southwest arrow",
    "↖   Northwest arrow",
    "⇒   Double right arrow",
    "⇐   Double left arrow",
    "⇔   Double left-right",
    "➜   Heavy right arrow",
    "➤   Arrowhead right",
    "➡️  Right arrow emoji",
    "⬅️  Left arrow emoji",
    "⬆️  Up arrow emoji",
    "⬇️  Down arrow emoji",
    "↩️  Return arrow",
    "↪️  Forward return arrow",
    "🔄  Refresh/cycle arrows",
    "🔃  Clockwise arrows",
    "🔁  Repeat arrows",
    "🔀  Shuffle arrows"
)

# ==================== TECH & HARDWARE ====================
Show-EmojiCategory "TECH & HARDWARE" "Cyan" @(
    "💻  Laptop",
    "🖥️  Desktop",
    "🖨️  Printer",
    "⌨️  Keyboard",
    "🖱️  Mouse",
    "🔌  Electric plug",
    "🔋  Battery",
    "📱  Phone",
    "📲  Phone with arrow",
    "💾  Floppy disk",
    "💿  CD",
    "📀  DVD",
    "🎮  Game controller",
    "🕹️  Joystick",
    "🔧  Wrench",
    "🛠️  Hammer and wrench",
    "⚙️  Gear",
    "🔩  Nut and bolt",
    "🔨  Hammer",
    "⛏️  Pick",
    "🧲  Magnet",
    "📡  Antenna",
    "📶  Signal bars",
    "🖧   Network (if supported)"
)

# ==================== FILES & FOLDERS ====================
Show-EmojiCategory "FILES & FOLDERS" "Blue" @(
    "📁  Folder",
    "📂  Open folder",
    "🗂️  Card index dividers",
    "📄  Document",
    "📃  Page with curl",
    "📋  Clipboard",
    "📜  Scroll",
    "📑  Bookmark tabs",
    "📝  Memo/notepad",
    "📰  Newspaper",
    "🗄️  File cabinet",
    "🗃️  Card file box",
    "🗑️  Trash",
    "🔖  Bookmark"
)

# ==================== COMMUNICATION ====================
Show-EmojiCategory "COMMUNICATION" "Green" @(
    "📧  Email",
    "📨  Incoming envelope",
    "📩  Envelope with arrow",
    "📤  Outbox tray",
    "📥  Inbox tray",
    "📬  Mailbox with mail",
    "📭  Empty mailbox",
    "📮  Postbox",
    "✉️  Envelope",
    "💬  Speech bubble",
    "💭  Thought bubble",
    "🗨️  Left speech bubble",
    "🗯️  Right anger bubble"
)

# ==================== EDITING & WRITING ====================
Show-EmojiCategory "EDITING & WRITING" "Yellow" @(
    "✏️  Pencil",
    "✒️  Black nib",
    "🖊️  Pen",
    "🖋️  Fountain pen",
    "🖍️  Crayon",
    "📏  Ruler",
    "📐  Triangle ruler",
    "✂️  Scissors",
    "🔏  Locked with pen",
    "🔐  Locked with key"
)

# ==================== SECURITY & LOCKS ====================
Show-EmojiCategory "SECURITY & LOCKS" "Red" @(
    "🔒  Locked",
    "🔓  Unlocked",
    "🔑  Key",
    "🗝️  Old key",
    "🛡️  Shield",
    "⚔️  Crossed swords",
    "🔐  Locked with key"
)

# ==================== CHARTS & DATA ====================
Show-EmojiCategory "CHARTS & DATA" "Magenta" @(
    "📊  Bar chart",
    "📈  Chart increasing",
    "📉  Chart decreasing",
    "📆  Calendar",
    "📅  Calendar",
    "🗓️  Spiral calendar",
    "📇  Card index",
    "🔢  Numbers",
    "🔤  Letters",
    "🔣  Symbols",
    "#️⃣  Hash/number sign",
    "*️⃣  Asterisk"
)

# ==================== WEATHER & ELEMENTS ====================
Show-EmojiCategory "WEATHER & ELEMENTS" "Cyan" @(
    "☀️  Sun",
    "🌙  Moon",
    "⭐  Star",
    "🌟  Glowing star",
    "✨  Sparkles",
    "⚡  Lightning",
    "🔥  Fire",
    "💧  Water drop",
    "❄️  Snowflake",
    "🌊  Wave",
    "☁️  Cloud",
    "🌀  Cyclone/fan",
    "🌡️  Thermometer",
    "💨  Wind/dash"
)

# ==================== EMERGENCY & ALERTS ====================
Show-EmojiCategory "EMERGENCY & ALERTS" "Red" @(
    "🚨  Siren/emergency",
    "🚒  Fire truck",
    "🚑  Ambulance",
    "🆘  SOS",
    "🆗  OK button",
    "🆙  UP button",
    "🔺  Red triangle up",
    "🔻  Red triangle down",
    "⏰  Alarm clock",
    "⏱️  Stopwatch",
    "⏲️  Timer"
)

# ==================== NETWORKING & WEB ====================
Show-EmojiCategory "NETWORKING & WEB" "Blue" @(
    "🌐  Globe",
    "🌍  Earth Africa",
    "🌎  Earth Americas",
    "🌏  Earth Asia",
    "🔗  Link",
    "⛓️  Chains",
    "🔍  Magnifying glass left",
    "🔎  Magnifying glass right",
    "📡  Satellite dish"
)

# ==================== PUNCTUATION & SYMBOLS ====================
Show-EmojiCategory "PUNCTUATION & SYMBOLS" "White" @(
    "•   Bullet point",
    "‣   Triangle bullet",
    "⁃   Hyphen bullet",
    "°   Degree symbol",
    "×   Multiplication",
    "÷   Division",
    "±   Plus-minus",
    "∞   Infinity",
    "≈   Approximately",
    "≠   Not equal",
    "≤   Less or equal",
    "≥   Greater or equal",
    "©   Copyright",
    "®   Registered",
    "™   Trademark",
    "§   Section",
    "¶   Pilcrow/paragraph",
    "†   Dagger",
    "‡   Double dagger",
    "※   Reference mark"
)

# ==================== NUMBERS & LETTERS ====================
Show-EmojiCategory "NUMBERS IN CIRCLES" "Yellow" @(
    "①②③④⑤⑥⑦⑧⑨⑩  Circled numbers",
    "❶❷❸❹❺❻❼❽❾❿  Negative circled",
    "⓪  Zero circled",
    "Ⓐ Ⓑ Ⓒ Ⓓ Ⓔ  Circled letters"
)

# ==================== FACES (if needed for fun) ====================
Show-EmojiCategory "FACES (limited use)" "Green" @(
    "😊  Smiling",
    "😃  Grinning",
    "🙂  Slightly smiling",
    "😐  Neutral",
    "😕  Confused",
    "😢  Crying",
    "😤  Huffing",
    "🤔  Thinking",
    "😎  Cool",
    "🤖  Robot"
)

# ==================== HANDS & GESTURES ====================
Show-EmojiCategory "HANDS & GESTURES" "Magenta" @(
    "👍  Thumbs up",
    "👎  Thumbs down",
    "👌  OK hand",
    "✋  Raised hand",
    "👋  Waving hand",
    "👆  Pointing up",
    "👇  Pointing down",
    "👈  Pointing left",
    "👉  Pointing right",
    "🤞  Crossed fingers",
    "✌️  Victory/peace"
)

# ==================== MISCELLANEOUS ====================
Show-EmojiCategory "MISCELLANEOUS" "Cyan" @(
    "💎  Gem",
    "🏆  Trophy",
    "🎯  Bullseye/target",
    "🎪  Circus tent (for fun)",
    "🏷️  Label/tag",
    "🔮  Crystal ball",
    "💉  Syringe",
    "💊  Pill",
    "🧪  Test tube",
    "🧬  DNA",
    "🔬  Microscope",
    "🔭  Telescope",
    "📦  Package/box",
    "🎁  Gift",
    "🪄  Magic wand"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "           LOG FORMAT EXAMPLES          " -ForegroundColor Cyan  
Write-Host "========================================`n"

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "[$ts] [INFO] ✅ WebSocket connected"
Write-Host "[$ts] [INFO] ✅ Agent registered: pankha-windows"
Write-Host "[$ts] [INFO] ✏️ Failsafe Speed changed: 50% → 70%"
Write-Host "[$ts] [INFO] 📊 Discovered 15 sensors"
Write-Host "[$ts] [INFO] 🌀 Discovered 5 fans"
Write-Host "[$ts] [WARN] ⚠️ ENTERING FAILSAFE MODE - Backend disconnected"
Write-Host "[$ts] [WARN] 🚨 EMERGENCY: 85°C >= 80°C - ALL FANS TO 100%"
Write-Host "[$ts] [DEBUG] 📨 ReceiveLoop started"
Write-Host "[$ts] [DEBUG] 📬 Received message: 256 bytes"
Write-Host "[$ts] [DEBUG] 🔄 DataTransmissionLoop started"
Write-Host "[$ts] [DEBUG] 🛑 Loop exited gracefully"
Write-Host "[$ts] [ERROR] ❌ Failed to connect"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Mark ?? emojis and report back!" -ForegroundColor Yellow
Write-Host "========================================`n"
