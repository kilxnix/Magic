# Car Rental Empire - Roblox Simulation Game Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Roblox life simulation game centered around running car rental businesses across explorable real-world cities, starting with a Columbus, Ohio MVP.

**Architecture:** Roblox Studio project using Luau scripting with client-server architecture. Server handles economy, NPC AI, time system, and persistence. Client handles UI, camera, and local interactions. Data stored via Roblox DataStoreService. AI NPCs use behavior trees with personality traits for dynamic interactions.

**Tech Stack:** Roblox Studio, Luau (Roblox's Lua variant), DataStoreService (persistence), RemoteEvents/Functions (client-server communication), Rojo (file sync for version control)

---

## Game Design Document (Reference)

### Core Loop
1. Player spawns in Columbus, Ohio
2. Chooses 1 of 8 career paths (or Vacation Mode)
3. Works to earn money in accelerated time (1 real min = 7 game min)
4. Progresses career, buys/upgrades rental locations
5. Can franchise to expand empire
6. Explore city, airport, neighborhoods

### 8 Career Paths
1. **Rental Counter Agent** - Work the desk at a rental location, check in/out customers, upsell insurance and upgrades
2. **Fleet Mechanic** - Repair, maintain, detail vehicles at the shop. Higher skill = faster repairs = more pay
3. **Franchise Owner** - Start with small lot, manage inventory, hire NPCs, set prices, grow to multiple locations
4. **Airport Shuttle Driver** - Drive passengers between terminals and rental lots, tips system
5. **Car Transporter** - Haul vehicles between locations on flatbed, acquire new fleet from auctions
6. **Sales & Marketing Rep** - Visit corporate offices, negotiate fleet contracts, run advertising campaigns
7. **Food Court Worker** - Work at airport/mall food courts, cook orders, serve customers, earn tips
8. **Janitor** - Clean rental locations, airport terminals, and city buildings. Maintain cleanliness ratings

### Vacation Mode
- Player rents a car from any location
- Free-roam the city with objectives (landmarks, restaurants, events)
- Earns small passive income from owned businesses while on vacation

### Time System
- 1 real minute = 7 game minutes
- Full game day = ~3.43 real hours
- Day/night cycle with lighting changes
- NPC schedules tied to game time (rush hours, slow periods)

### Monetization
- Free to play
- Robux currency boost (2x earnings game pass)
- Cosmetic car wraps and shop decorations
- VIP server access

---

## Phase 1: Project Foundation

### Task 1: Rojo Project Setup & File Structure

**Files:**
- Create: `default.project.json`
- Create: `src/server/init.server.luau`
- Create: `src/client/init.client.luau`
- Create: `src/shared/init.luau`
- Create: `.gitignore`

**Step 1: Initialize Rojo project structure**

Create the Rojo configuration for file-based Roblox development:

```json
// default.project.json
{
  "name": "CarRentalEmpire",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "Shared": {
        "$path": "src/shared"
      }
    },
    "ServerScriptService": {
      "$className": "ServerScriptService",
      "Server": {
        "$path": "src/server"
      }
    },
    "StarterPlayerScripts": {
      "$className": "StarterPlayerScripts",
      "Client": {
        "$path": "src/client"
      }
    },
    "ReplicatedFirst": {
      "$className": "ReplicatedFirst",
      "Loading": {
        "$path": "src/loading"
      }
    },
    "StarterGui": {
      "$className": "StarterGui",
      "UI": {
        "$path": "src/ui"
      }
    }
  }
}
```

**Step 2: Create shared constants module**

```lua
-- src/shared/Constants.luau
local Constants = {}

Constants.TIME_MULTIPLIER = 7 -- 1 real minute = 7 game minutes
Constants.GAME_DAY_SECONDS = (24 * 60 * 60) / Constants.TIME_MULTIPLIER -- ~12,342 real seconds per game day

Constants.CAREERS = {
    RENTAL_AGENT = "RentalAgent",
    MECHANIC = "Mechanic",
    FRANCHISE_OWNER = "FranchiseOwner",
    SHUTTLE_DRIVER = "ShuttleDriver",
    CAR_TRANSPORTER = "CarTransporter",
    SALES_REP = "SalesRep",
    FOOD_COURT_WORKER = "FoodCourtWorker",
    JANITOR = "Janitor",
}

Constants.STARTING_MONEY = 500
Constants.CURRENCY_NAME = "Dollars"

Constants.CAR_CLASSES = {
    ECONOMY = { name = "Economy", dailyRate = 35, examples = {"Toyota Corolla", "Honda Civic", "Nissan Sentra"} },
    COMPACT = { name = "Compact", dailyRate = 45, examples = {"Mazda 3", "VW Jetta", "Hyundai Elantra"} },
    MIDSIZE = { name = "Midsize", dailyRate = 60, examples = {"Toyota Camry", "Honda Accord", "Ford Fusion"} },
    FULLSIZE = { name = "Full Size", dailyRate = 75, examples = {"Chevrolet Impala", "Dodge Charger", "Chrysler 300"} },
    SUV = { name = "SUV", dailyRate = 85, examples = {"Ford Explorer", "Chevrolet Tahoe", "Toyota 4Runner"} },
    LUXURY = { name = "Luxury", dailyRate = 150, examples = {"BMW 5 Series", "Mercedes E-Class", "Audi A6"} },
    EXOTIC = { name = "Exotic", dailyRate = 500, examples = {"Lamborghini Huracan", "Ferrari 488", "McLaren 720S"} },
    TRUCK = { name = "Truck", dailyRate = 70, examples = {"Ford F-150", "RAM 1500", "Chevrolet Silverado"} },
}

Constants.NPC_PERSONALITIES = {
    FRIENDLY = "Friendly",
    IMPATIENT = "Impatient",
    INDECISIVE = "Indecisive",
    BUSINESS = "Business",
    TOURIST = "Tourist",
    BUDGET = "Budget",
}

return Constants
```

**Step 3: Create .gitignore**

```
# .gitignore
*.rbxl
*.rbxlx
*.rbxm
*.rbxmx
node_modules/
.DS_Store
```

**Step 4: Commit**

```bash
git add default.project.json src/ .gitignore
git commit -m "feat: initialize Rojo project structure with shared constants"
```

---

### Task 2: Data Persistence System

**Files:**
- Create: `src/server/DataManager.luau`
- Create: `src/server/tests/DataManager.spec.luau`

**Step 1: Write the failing test**

```lua
-- src/server/tests/DataManager.spec.luau
local DataManager = require(script.Parent.Parent.DataManager)

return function()
    describe("DataManager", function()
        it("should create default player data", function()
            local data = DataManager.getDefaultData()
            expect(data.money).to.equal(500)
            expect(data.career).to.equal("")
            expect(data.level).to.equal(1)
            expect(data.ownedLocations).to.be.a("table")
            expect(#data.ownedLocations).to.equal(0)
        end)

        it("should validate data structure", function()
            local valid = DataManager.validateData({ money = 100, career = "Mechanic", level = 1, ownedLocations = {} })
            expect(valid).to.equal(true)

            local invalid = DataManager.validateData({ money = "bad" })
            expect(invalid).to.equal(false)
        end)
    end)
end
```

**Step 2: Run test to verify it fails**

Run: Open Roblox Studio > Run TestEZ suite
Expected: FAIL - DataManager module not found

**Step 3: Write the DataManager module**

```lua
-- src/server/DataManager.luau
local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local Constants = require(game.ReplicatedStorage.Shared.Constants)

local DataManager = {}
DataManager.__index = DataManager

local playerDataStore = DataStoreService:GetDataStore("PlayerData_v1")
local sessionData = {} -- In-memory cache

function DataManager.getDefaultData()
    return {
        money = Constants.STARTING_MONEY,
        career = "",
        level = 1,
        xp = 0,
        ownedLocations = {},
        ownedCars = {},
        reputation = 50,
        totalEarnings = 0,
        playTime = 0,
        achievements = {},
        settings = {
            musicVolume = 0.5,
            sfxVolume = 0.8,
        },
    }
end

function DataManager.validateData(data)
    if type(data) ~= "table" then return false end
    if type(data.money) ~= "number" then return false end
    if type(data.career) ~= "string" then return false end
    if type(data.level) ~= "number" then return false end
    if type(data.ownedLocations) ~= "table" then return false end
    return true
end

function DataManager.loadPlayerData(player: Player)
    local key = "Player_" .. player.UserId
    local success, data = pcall(function()
        return playerDataStore:GetAsync(key)
    end)

    if success and data and DataManager.validateData(data) then
        sessionData[player.UserId] = data
    else
        sessionData[player.UserId] = DataManager.getDefaultData()
    end

    return sessionData[player.UserId]
end

function DataManager.savePlayerData(player: Player)
    local data = sessionData[player.UserId]
    if not data then return false end

    local key = "Player_" .. player.UserId
    local success, err = pcall(function()
        playerDataStore:SetAsync(key, data)
    end)

    if not success then
        warn("Failed to save data for " .. player.Name .. ": " .. tostring(err))
    end
    return success
end

function DataManager.getData(player: Player)
    return sessionData[player.UserId]
end

function DataManager.updateMoney(player: Player, amount: number)
    local data = sessionData[player.UserId]
    if not data then return false end
    data.money = math.max(0, data.money + amount)
    if amount > 0 then
        data.totalEarnings = data.totalEarnings + amount
    end
    return true
end

function DataManager.setCareer(player: Player, career: string)
    local data = sessionData[player.UserId]
    if not data then return false end
    data.career = career
    return true
end

function DataManager.cleanup(player: Player)
    DataManager.savePlayerData(player)
    sessionData[player.UserId] = nil
end

return DataManager
```

**Step 4: Run test to verify it passes**

Run: Open Roblox Studio > Run TestEZ suite
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/DataManager.luau src/server/tests/
git commit -m "feat: add player data persistence with DataStoreService"
```

---

### Task 3: Time System (7x Acceleration)

**Files:**
- Create: `src/server/TimeSystem.luau`
- Create: `src/client/TimeDisplay.luau`
- Create: `src/shared/TimeUtils.luau`

**Step 1: Write shared time utilities**

```lua
-- src/shared/TimeUtils.luau
local Constants = require(script.Parent.Constants)

local TimeUtils = {}

function TimeUtils.realToGameSeconds(realSeconds: number): number
    return realSeconds * Constants.TIME_MULTIPLIER
end

function TimeUtils.gameToRealSeconds(gameSeconds: number): number
    return gameSeconds / Constants.TIME_MULTIPLIER
end

function TimeUtils.getGameTimeOfDay(gameSeconds: number): (number, number, number)
    local totalGameMinutes = (gameSeconds * Constants.TIME_MULTIPLIER) / 60
    local gameHour = math.floor(totalGameMinutes / 60) % 24
    local gameMinute = math.floor(totalGameMinutes) % 60
    local gameSecond = math.floor(gameSeconds * Constants.TIME_MULTIPLIER) % 60
    return gameHour, gameMinute, gameSecond
end

function TimeUtils.formatTime(hour: number, minute: number): string
    local period = hour >= 12 and "PM" or "AM"
    local displayHour = hour % 12
    if displayHour == 0 then displayHour = 12 end
    return string.format("%d:%02d %s", displayHour, minute, period)
end

function TimeUtils.isRushHour(hour: number): boolean
    return (hour >= 7 and hour <= 9) or (hour >= 16 and hour <= 18)
end

function TimeUtils.isNightTime(hour: number): boolean
    return hour >= 22 or hour <= 5
end

return TimeUtils
```

**Step 2: Write server time controller**

```lua
-- src/server/TimeSystem.luau
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Constants = require(game.ReplicatedStorage.Shared.Constants)
local TimeUtils = require(game.ReplicatedStorage.Shared.TimeUtils)

local TimeSystem = {}
TimeSystem.__index = TimeSystem

local gameStartTime = 0 -- Accumulated game seconds since server start
local START_HOUR = 8 -- Game starts at 8:00 AM

function TimeSystem.init()
    gameStartTime = START_HOUR * 3600 / Constants.TIME_MULTIPLIER

    -- Create remote event for syncing time to clients
    local timeEvent = Instance.new("RemoteEvent")
    timeEvent.Name = "TimeSync"
    timeEvent.Parent = ReplicatedStorage

    RunService.Heartbeat:Connect(function(dt)
        gameStartTime = gameStartTime + dt
        local hour, minute = TimeUtils.getGameTimeOfDay(gameStartTime)

        -- Update Roblox lighting to match game time
        Lighting.ClockTime = hour + (minute / 60)

        -- Adjust ambient lighting for day/night
        if TimeUtils.isNightTime(hour) then
            Lighting.Ambient = Color3.fromRGB(50, 50, 80)
            Lighting.Brightness = 0.5
        else
            Lighting.Ambient = Color3.fromRGB(150, 150, 150)
            Lighting.Brightness = 2
        end
    end)

    -- Sync time to clients every 10 real seconds
    task.spawn(function()
        while true do
            task.wait(10)
            local hour, minute = TimeUtils.getGameTimeOfDay(gameStartTime)
            timeEvent:FireAllClients(hour, minute, gameStartTime)
        end
    end)
end

function TimeSystem.getGameTime(): (number, number, number)
    return TimeUtils.getGameTimeOfDay(gameStartTime)
end

function TimeSystem.getElapsedGameSeconds(): number
    return gameStartTime * Constants.TIME_MULTIPLIER
end

return TimeSystem
```

**Step 3: Write client time display**

```lua
-- src/client/TimeDisplay.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local TimeUtils = require(game.ReplicatedStorage.Shared.TimeUtils)

local TimeDisplay = {}

local currentHour = 8
local currentMinute = 0

function TimeDisplay.init(timeLabel: TextLabel)
    local timeEvent = ReplicatedStorage:WaitForChild("TimeSync")

    timeEvent.OnClientEvent:Connect(function(hour, minute, serverTime)
        currentHour = hour
        currentMinute = minute
        timeLabel.Text = TimeUtils.formatTime(hour, minute)
    end)
end

function TimeDisplay.getCurrentTime(): (number, number)
    return currentHour, currentMinute
end

return TimeDisplay
```

**Step 4: Commit**

```bash
git add src/shared/TimeUtils.luau src/server/TimeSystem.luau src/client/TimeDisplay.luau
git commit -m "feat: add 7x accelerated time system with day/night cycle"
```

---

### Task 4: Economy & Money System

**Files:**
- Create: `src/server/EconomySystem.luau`
- Create: `src/shared/EconomyConfig.luau`

**Step 1: Write economy configuration**

```lua
-- src/shared/EconomyConfig.luau
local EconomyConfig = {}

-- Career base pay per game-hour worked
EconomyConfig.CAREER_PAY = {
    RentalAgent = { base = 15, tipChance = 0.3, tipRange = {5, 25} },
    Mechanic = { base = 20, bonusPerRepair = 10 },
    FranchiseOwner = { base = 0, revenueShare = 0.7 }, -- Earns from business
    ShuttleDriver = { base = 12, tipChance = 0.5, tipRange = {3, 15} },
    CarTransporter = { base = 18, bonusPerDelivery = 25 },
    SalesRep = { base = 10, commissionRate = 0.05 }, -- 5% of contracts
    FoodCourtWorker = { base = 12, tipChance = 0.4, tipRange = {2, 10} },
    Janitor = { base = 14, cleaningBonus = 5 }, -- Bonus per area cleaned
}

-- Location purchase costs
EconomyConfig.LOCATION_COSTS = {
    SmallLot = { price = 5000, capacity = 10, name = "Small Lot" },
    MediumLot = { price = 15000, capacity = 25, name = "Medium Lot" },
    LargeLot = { price = 50000, capacity = 50, name = "Large Lot" },
    AirportCounter = { price = 100000, capacity = 40, name = "Airport Counter" },
}

-- Car purchase costs (for fleet owners)
EconomyConfig.CAR_COSTS = {
    Economy = 15000,
    Compact = 20000,
    Midsize = 28000,
    FullSize = 35000,
    SUV = 42000,
    Luxury = 65000,
    Exotic = 250000,
    Truck = 38000,
}

-- Franchise costs
EconomyConfig.FRANCHISE_FEE = 25000
EconomyConfig.FRANCHISE_ROYALTY_RATE = 0.08 -- 8% of revenue to franchisor

-- Robux boost multiplier
EconomyConfig.ROBUX_BOOST_MULTIPLIER = 2

-- Level XP requirements
EconomyConfig.XP_PER_LEVEL = {
    100, 250, 500, 1000, 2000, 3500, 5500, 8000, 12000, 18000
}

return EconomyConfig
```

**Step 2: Write economy system**

```lua
-- src/server/EconomySystem.luau
local MarketplaceService = game:GetService("MarketplaceService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local DataManager = require(script.Parent.DataManager)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local EconomySystem = {}

-- Game pass ID for 2x earnings (set in Roblox Creator Dashboard)
local BOOST_GAMEPASS_ID = 0 -- Replace with actual ID

function EconomySystem.init()
    local moneyEvent = Instance.new("RemoteEvent")
    moneyEvent.Name = "MoneyUpdate"
    moneyEvent.Parent = ReplicatedStorage
end

function EconomySystem.hasBoost(player: Player): boolean
    local success, hasPass = pcall(function()
        return MarketplaceService:UserOwnsGamePassAsync(player.UserId, BOOST_GAMEPASS_ID)
    end)
    return success and hasPass
end

function EconomySystem.payPlayer(player: Player, amount: number, reason: string)
    local multiplier = EconomySystem.hasBoost(player) and EconomyConfig.ROBUX_BOOST_MULTIPLIER or 1
    local finalAmount = math.floor(amount * multiplier)

    DataManager.updateMoney(player, finalAmount)

    -- Notify client
    local moneyEvent = ReplicatedStorage:FindFirstChild("MoneyUpdate")
    if moneyEvent then
        local data = DataManager.getData(player)
        moneyEvent:FireClient(player, data.money, finalAmount, reason)
    end

    return finalAmount
end

function EconomySystem.chargePlayer(player: Player, amount: number): boolean
    local data = DataManager.getData(player)
    if not data or data.money < amount then
        return false
    end
    DataManager.updateMoney(player, -amount)

    local moneyEvent = ReplicatedStorage:FindFirstChild("MoneyUpdate")
    if moneyEvent then
        moneyEvent:FireClient(player, data.money, -amount, "Purchase")
    end
    return true
end

function EconomySystem.addXP(player: Player, amount: number)
    local data = DataManager.getData(player)
    if not data then return end

    data.xp = data.xp + amount
    local requiredXP = EconomyConfig.XP_PER_LEVEL[data.level] or 20000
    if data.xp >= requiredXP then
        data.level = data.level + 1
        data.xp = data.xp - requiredXP
        -- Could fire a level-up event here
    end
end

return EconomySystem
```

**Step 3: Commit**

```bash
git add src/shared/EconomyConfig.luau src/server/EconomySystem.luau
git commit -m "feat: add economy system with career pay, leveling, and Robux boost"
```

---

## Phase 2: Career System

### Task 5: Career Selection UI

**Files:**
- Create: `src/ui/CareerSelect.luau`
- Create: `src/ui/Components/CareerCard.luau`

**Step 1: Write career card component**

```lua
-- src/ui/Components/CareerCard.luau
local CareerCard = {}

local CAREER_INFO = {
    RentalAgent = {
        title = "Rental Counter Agent",
        description = "Work the front desk. Check customers in/out, upsell insurance and upgrades.",
        icon = "rbxassetid://0", -- Replace with actual asset ID
        startingPay = "$15/hr + tips",
    },
    Mechanic = {
        title = "Fleet Mechanic",
        description = "Keep the fleet running. Repair, maintain, and detail vehicles.",
        icon = "rbxassetid://0",
        startingPay = "$20/hr + repair bonuses",
    },
    FranchiseOwner = {
        title = "Franchise Owner",
        description = "Build your empire. Buy lots, stock cars, hire staff, set prices.",
        icon = "rbxassetid://0",
        startingPay = "Revenue-based (high risk/reward)",
    },
    ShuttleDriver = {
        title = "Airport Shuttle Driver",
        description = "Drive passengers between terminals and rental lots. Earn tips!",
        icon = "rbxassetid://0",
        startingPay = "$12/hr + tips",
    },
    CarTransporter = {
        title = "Car Transporter",
        description = "Haul vehicles on flatbeds. Deliver between locations and auctions.",
        icon = "rbxassetid://0",
        startingPay = "$18/hr + delivery bonuses",
    },
    SalesRep = {
        title = "Sales & Marketing Rep",
        description = "Land corporate contracts. Run ad campaigns. Grow the business.",
        icon = "rbxassetid://0",
        startingPay = "$10/hr + 5% commission",
    },
    FoodCourtWorker = {
        title = "Food Court Worker",
        description = "Cook and serve food at airport and mall food courts. Fast hands = more tips!",
        icon = "rbxassetid://0",
        startingPay = "$12/hr + tips",
    },
    Janitor = {
        title = "Janitor",
        description = "Keep locations spotless. Clean rental lots, terminals, and city buildings.",
        icon = "rbxassetid://0",
        startingPay = "$14/hr + cleaning bonuses",
    },
}

function CareerCard.create(careerKey: string, parent: Frame): Frame
    local info = CAREER_INFO[careerKey]
    if not info then return nil end

    local card = Instance.new("Frame")
    card.Name = careerKey .. "Card"
    card.Size = UDim2.new(0.3, 0, 0.4, 0)
    card.BackgroundColor3 = Color3.fromRGB(40, 40, 60)
    card.BorderSizePixel = 0
    card.Parent = parent

    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 12)
    corner.Parent = card

    local title = Instance.new("TextLabel")
    title.Name = "Title"
    title.Size = UDim2.new(0.9, 0, 0.15, 0)
    title.Position = UDim2.new(0.05, 0, 0.05, 0)
    title.BackgroundTransparency = 1
    title.Text = info.title
    title.TextColor3 = Color3.fromRGB(255, 255, 255)
    title.TextScaled = true
    title.Font = Enum.Font.GothamBold
    title.Parent = card

    local desc = Instance.new("TextLabel")
    desc.Name = "Description"
    desc.Size = UDim2.new(0.9, 0, 0.35, 0)
    desc.Position = UDim2.new(0.05, 0, 0.25, 0)
    desc.BackgroundTransparency = 1
    desc.Text = info.description
    desc.TextColor3 = Color3.fromRGB(200, 200, 200)
    desc.TextScaled = true
    desc.TextWrapped = true
    desc.Font = Enum.Font.Gotham
    desc.Parent = card

    local pay = Instance.new("TextLabel")
    pay.Name = "Pay"
    pay.Size = UDim2.new(0.9, 0, 0.1, 0)
    pay.Position = UDim2.new(0.05, 0, 0.65, 0)
    pay.BackgroundTransparency = 1
    pay.Text = info.startingPay
    pay.TextColor3 = Color3.fromRGB(100, 255, 100)
    pay.TextScaled = true
    pay.Font = Enum.Font.GothamBold
    pay.Parent = card

    local selectBtn = Instance.new("TextButton")
    selectBtn.Name = "SelectButton"
    selectBtn.Size = UDim2.new(0.8, 0, 0.12, 0)
    selectBtn.Position = UDim2.new(0.1, 0, 0.82, 0)
    selectBtn.BackgroundColor3 = Color3.fromRGB(0, 120, 255)
    selectBtn.Text = "Choose This Career"
    selectBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
    selectBtn.TextScaled = true
    selectBtn.Font = Enum.Font.GothamBold
    selectBtn.Parent = card

    local btnCorner = Instance.new("UICorner")
    btnCorner.CornerRadius = UDim.new(0, 8)
    btnCorner.Parent = selectBtn

    return card
end

return CareerCard
```

**Step 2: Write career selection screen**

```lua
-- src/ui/CareerSelect.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local CareerCard = require(script.Parent.Components.CareerCard)
local Constants = require(game.ReplicatedStorage.Shared.Constants)

local CareerSelect = {}

function CareerSelect.show(playerGui: PlayerGui, onSelect: (string) -> ())
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "CareerSelectUI"
    screenGui.ResetOnSpawn = false
    screenGui.Parent = playerGui

    -- Background
    local bg = Instance.new("Frame")
    bg.Name = "Background"
    bg.Size = UDim2.new(1, 0, 1, 0)
    bg.BackgroundColor3 = Color3.fromRGB(20, 20, 30)
    bg.Parent = screenGui

    -- Title
    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(0.8, 0, 0.08, 0)
    title.Position = UDim2.new(0.1, 0, 0.02, 0)
    title.BackgroundTransparency = 1
    title.Text = "Choose Your Career Path"
    title.TextColor3 = Color3.fromRGB(255, 255, 255)
    title.TextScaled = true
    title.Font = Enum.Font.GothamBold
    title.Parent = bg

    -- Career grid
    local grid = Instance.new("Frame")
    grid.Name = "CareerGrid"
    grid.Size = UDim2.new(0.9, 0, 0.82, 0)
    grid.Position = UDim2.new(0.05, 0, 0.12, 0)
    grid.BackgroundTransparency = 1
    grid.Parent = bg

    local gridLayout = Instance.new("UIGridLayout")
    gridLayout.CellSize = UDim2.new(0.23, -10, 0.45, -10)
    gridLayout.CellPadding = UDim2.new(0.02, 0, 0.03, 0)
    gridLayout.SortOrder = Enum.SortOrder.LayoutOrder
    gridLayout.Parent = grid

    -- Create career cards
    local careers = {"RentalAgent", "Mechanic", "FranchiseOwner", "ShuttleDriver", "CarTransporter", "SalesRep", "FoodCourtWorker", "Janitor"}
    for i, career in ipairs(careers) do
        local card = CareerCard.create(career, grid)
        if card then
            card.LayoutOrder = i
            local btn = card:FindFirstChild("SelectButton")
            if btn then
                btn.MouseButton1Click:Connect(function()
                    onSelect(career)
                    screenGui:Destroy()
                end)
            end
        end
    end

    -- Vacation mode button
    local vacationBtn = Instance.new("TextButton")
    vacationBtn.Name = "VacationButton"
    vacationBtn.Size = UDim2.new(0.3, 0, 0.06, 0)
    vacationBtn.Position = UDim2.new(0.35, 0, 0.93, 0)
    vacationBtn.BackgroundColor3 = Color3.fromRGB(255, 165, 0)
    vacationBtn.Text = "Vacation Mode (Free Roam)"
    vacationBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
    vacationBtn.TextScaled = true
    vacationBtn.Font = Enum.Font.GothamBold
    vacationBtn.Parent = bg

    local vacCorner = Instance.new("UICorner")
    vacCorner.CornerRadius = UDim.new(0, 8)
    vacCorner.Parent = vacationBtn

    vacationBtn.MouseButton1Click:Connect(function()
        onSelect("Vacation")
        screenGui:Destroy()
    end)

    return screenGui
end

return CareerSelect
```

**Step 3: Commit**

```bash
git add src/ui/
git commit -m "feat: add career selection UI with 6 career cards and vacation mode"
```

---

### Task 6: Career Gameplay - Rental Counter Agent

**Files:**
- Create: `src/server/Careers/RentalAgent.luau`
- Create: `src/client/Careers/RentalAgentUI.luau`

**Step 1: Write rental agent server logic**

```lua
-- src/server/Careers/RentalAgent.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local EconomySystem = require(script.Parent.Parent.EconomySystem)
local TimeSystem = require(script.Parent.Parent.TimeSystem)
local Constants = require(game.ReplicatedStorage.Shared.Constants)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local RentalAgent = {}
RentalAgent.__index = RentalAgent

function RentalAgent.new(player: Player, location)
    local self = setmetatable({}, RentalAgent)
    self.player = player
    self.location = location
    self.isWorking = false
    self.customersServed = 0
    self.shiftStart = 0
    return self
end

function RentalAgent:startShift()
    self.isWorking = true
    self.shiftStart = tick()
    self.customersServed = 0

    -- Start spawning customers
    task.spawn(function()
        while self.isWorking do
            local hour = TimeSystem.getGameTime()
            local waitTime = if TimeUtils.isRushHour(hour) then 15 else 30 -- game seconds
            local realWait = waitTime / Constants.TIME_MULTIPLIER

            task.wait(realWait)
            if self.isWorking then
                self:spawnCustomer()
            end
        end
    end)
end

function RentalAgent:spawnCustomer()
    -- Generate a random customer with personality
    local personalities = {"Friendly", "Impatient", "Indecisive", "Business", "Tourist", "Budget"}
    local personality = personalities[math.random(1, #personalities)]

    local carClasses = {"Economy", "Compact", "Midsize", "FullSize", "SUV", "Luxury"}
    local desiredClass = carClasses[math.random(1, #carClasses)]

    local customer = {
        personality = personality,
        desiredClass = desiredClass,
        wantsInsurance = math.random() > 0.5,
        rentalDays = math.random(1, 14),
    }

    -- Fire event to client to show customer interaction UI
    local event = ReplicatedStorage:FindFirstChild("CustomerArrived")
    if event then
        event:FireClient(self.player, customer)
    end
end

function RentalAgent:serveCustomer(customer, offeredClass: string, addedInsurance: boolean)
    local carConfig = Constants.CAR_CLASSES[string.upper(offeredClass)]
    if not carConfig then return false end

    local revenue = carConfig.dailyRate * customer.rentalDays
    if addedInsurance then
        revenue = revenue + (15 * customer.rentalDays) -- $15/day insurance
    end

    -- Calculate agent commission
    local payConfig = EconomyConfig.CAREER_PAY.RentalAgent
    local pay = payConfig.base

    -- Tip chance based on personality match
    if math.random() < payConfig.tipChance then
        local tip = math.random(payConfig.tipRange[1], payConfig.tipRange[2])
        pay = pay + tip
    end

    -- Upsell bonus if they got a higher class than requested
    local classOrder = {"Economy", "Compact", "Midsize", "FullSize", "SUV", "Luxury", "Exotic"}
    local requestedIdx = table.find(classOrder, customer.desiredClass) or 1
    local offeredIdx = table.find(classOrder, offeredClass) or 1
    if offeredIdx > requestedIdx then
        pay = pay + (10 * (offeredIdx - requestedIdx)) -- $10 per class upgrade
    end

    EconomySystem.payPlayer(self.player, pay, "Customer served")
    EconomySystem.addXP(self.player, 15)
    self.customersServed = self.customersServed + 1

    return true
end

function RentalAgent:endShift()
    self.isWorking = false
    local shiftDuration = tick() - self.shiftStart
    return {
        customersServed = self.customersServed,
        duration = shiftDuration,
    }
end

return RentalAgent
```

**Step 2: Commit**

```bash
git add src/server/Careers/RentalAgent.luau
git commit -m "feat: add Rental Agent career with customer interactions and pay"
```

---

### Task 7: Career Gameplay - Fleet Mechanic

**Files:**
- Create: `src/server/Careers/Mechanic.luau`

**Step 1: Write mechanic career logic**

```lua
-- src/server/Careers/Mechanic.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local Mechanic = {}
Mechanic.__index = Mechanic

local REPAIR_TYPES = {
    OilChange = { difficulty = 1, time = 10, pay = 8 },
    TireRotation = { difficulty = 1, time = 15, pay = 10 },
    BrakeService = { difficulty = 2, time = 25, pay = 20 },
    EngineRepair = { difficulty = 3, time = 45, pay = 40 },
    Transmission = { difficulty = 4, time = 60, pay = 65 },
    Detailing = { difficulty = 1, time = 20, pay = 12 },
    ACRepair = { difficulty = 2, time = 30, pay = 25 },
    BodyWork = { difficulty = 3, time = 40, pay = 35 },
}

function Mechanic.new(player: Player)
    local self = setmetatable({}, Mechanic)
    self.player = player
    self.isWorking = false
    self.currentJob = nil
    self.skillLevel = 1 -- 1-10, affects speed and available jobs
    self.repairsCompleted = 0
    return self
end

function Mechanic:getAvailableJobs(): {any}
    local jobs = {}
    for name, config in pairs(REPAIR_TYPES) do
        if config.difficulty <= math.ceil(self.skillLevel / 2.5) then
            table.insert(jobs, {
                name = name,
                difficulty = config.difficulty,
                estimatedTime = math.floor(config.time / (1 + self.skillLevel * 0.1)),
                pay = config.pay,
            })
        end
    end
    return jobs
end

function Mechanic:startRepair(jobName: string)
    local config = REPAIR_TYPES[jobName]
    if not config then return false end
    if config.difficulty > math.ceil(self.skillLevel / 2.5) then return false end

    self.currentJob = {
        name = jobName,
        config = config,
        startTime = tick(),
        -- Speed bonus from skill level (10% faster per level)
        duration = config.time / (1 + self.skillLevel * 0.1),
        progress = 0,
    }
    return true
end

function Mechanic:completeRepair()
    if not self.currentJob then return nil end

    local config = self.currentJob.config
    local pay = config.pay + EconomyConfig.CAREER_PAY.Mechanic.bonusPerRepair

    -- Quality bonus based on time taken vs estimated
    local elapsed = tick() - self.currentJob.startTime
    if elapsed <= self.currentJob.duration then
        pay = pay + math.floor(config.pay * 0.2) -- 20% quality bonus
    end

    EconomySystem.payPlayer(self.player, pay, "Repair: " .. self.currentJob.name)
    EconomySystem.addXP(self.player, config.difficulty * 10)

    self.repairsCompleted = self.repairsCompleted + 1
    -- Level up skill every 10 repairs
    if self.repairsCompleted % 10 == 0 and self.skillLevel < 10 then
        self.skillLevel = self.skillLevel + 1
    end

    local result = self.currentJob.name
    self.currentJob = nil
    return result
end

return Mechanic
```

**Step 2: Commit**

```bash
git add src/server/Careers/Mechanic.luau
git commit -m "feat: add Mechanic career with repair types and skill progression"
```

---

### Task 8: Career Gameplay - Franchise Owner

**Files:**
- Create: `src/server/Careers/FranchiseOwner.luau`
- Create: `src/server/RentalLocation.luau`

**Step 1: Write rental location class**

```lua
-- src/server/RentalLocation.luau
local Constants = require(game.ReplicatedStorage.Shared.Constants)

local RentalLocation = {}
RentalLocation.__index = RentalLocation

function RentalLocation.new(config)
    local self = setmetatable({}, RentalLocation)
    self.id = config.id or game:GetService("HttpService"):GenerateGUID()
    self.name = config.name or "Unnamed Location"
    self.owner = config.owner -- Player UserId
    self.capacity = config.capacity or 10
    self.fleet = {} -- {carClass = count}
    self.employees = {} -- NPC employees
    self.dailyRevenue = 0
    self.reputation = 50 -- 0-100 affects customer flow
    self.priceMultiplier = 1.0 -- Owner can adjust prices
    self.isAirportLocation = config.isAirport or false
    return self
end

function RentalLocation:addCar(carClass: string): boolean
    local total = 0
    for _, count in pairs(self.fleet) do
        total = total + count
    end
    if total >= self.capacity then return false end

    self.fleet[carClass] = (self.fleet[carClass] or 0) + 1
    return true
end

function RentalLocation:removeCar(carClass: string): boolean
    if not self.fleet[carClass] or self.fleet[carClass] <= 0 then return false end
    self.fleet[carClass] = self.fleet[carClass] - 1
    return true
end

function RentalLocation:getAvailableCar(requestedClass: string): string?
    if self.fleet[requestedClass] and self.fleet[requestedClass] > 0 then
        return requestedClass
    end
    return nil
end

function RentalLocation:calculateHourlyRevenue(): number
    local totalCars = 0
    local totalValue = 0
    for class, count in pairs(self.fleet) do
        local carConfig = Constants.CAR_CLASSES[string.upper(class)]
        if carConfig then
            totalCars = totalCars + count
            -- Assume 60% utilization rate adjusted by reputation
            local utilization = 0.6 * (self.reputation / 100)
            totalValue = totalValue + (carConfig.dailyRate * count * utilization / 24)
        end
    end
    return math.floor(totalValue * self.priceMultiplier)
end

function RentalLocation:hireEmployee(npcData)
    table.insert(self.employees, {
        name = npcData.name,
        role = npcData.role, -- "counter", "mechanic", "cleaner"
        salary = npcData.salary,
        efficiency = npcData.efficiency or 1.0,
    })
end

function RentalLocation:getOperatingCosts(): number
    local costs = 0
    for _, emp in ipairs(self.employees) do
        costs = costs + emp.salary
    end
    return costs
end

return RentalLocation
```

**Step 2: Write franchise owner career**

```lua
-- src/server/Careers/FranchiseOwner.luau
local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)
local RentalLocation = require(script.Parent.Parent.RentalLocation)
local DataManager = require(script.Parent.Parent.DataManager)

local FranchiseOwner = {}
FranchiseOwner.__index = FranchiseOwner

function FranchiseOwner.new(player: Player)
    local self = setmetatable({}, FranchiseOwner)
    self.player = player
    self.locations = {} -- RentalLocation instances
    self.franchisees = {} -- Other players running your franchise
    return self
end

function FranchiseOwner:purchaseLocation(locationType: string, position: Vector3): RentalLocation?
    local config = EconomyConfig.LOCATION_COSTS[locationType]
    if not config then return nil end

    if not EconomySystem.chargePlayer(self.player, config.price) then
        return nil -- Can't afford
    end

    local location = RentalLocation.new({
        name = self.player.Name .. "'s " .. config.name,
        owner = self.player.UserId,
        capacity = config.capacity,
    })

    table.insert(self.locations, location)

    -- Save to player data
    local data = DataManager.getData(self.player)
    table.insert(data.ownedLocations, {
        id = location.id,
        type = locationType,
        position = {position.X, position.Y, position.Z},
    })

    return location
end

function FranchiseOwner:purchaseCar(location: RentalLocation, carClass: string): boolean
    local cost = EconomyConfig.CAR_COSTS[carClass]
    if not cost then return false end

    if not EconomySystem.chargePlayer(self.player, cost) then
        return false
    end

    return location:addCar(carClass)
end

function FranchiseOwner:collectRevenue()
    local totalRevenue = 0
    local totalCosts = 0

    for _, location in ipairs(self.locations) do
        local revenue = location:calculateHourlyRevenue()
        local costs = location:getOperatingCosts()
        totalRevenue = totalRevenue + revenue
        totalCosts = totalCosts + costs
    end

    -- Franchise royalties from franchisees
    local royalties = 0
    for _, franchisee in ipairs(self.franchisees) do
        -- 8% of their revenue
        royalties = royalties + math.floor(franchisee.lastRevenue * EconomyConfig.FRANCHISE_ROYALTY_RATE)
    end

    local netIncome = totalRevenue - totalCosts + royalties
    if netIncome > 0 then
        EconomySystem.payPlayer(self.player, netIncome, "Business revenue")
    end

    return { revenue = totalRevenue, costs = totalCosts, royalties = royalties, net = netIncome }
end

function FranchiseOwner:offerFranchise(targetPlayer: Player): boolean
    if not EconomySystem.chargePlayer(targetPlayer, EconomyConfig.FRANCHISE_FEE) then
        return false
    end

    table.insert(self.franchisees, {
        playerId = targetPlayer.UserId,
        lastRevenue = 0,
    })
    return true
end

return FranchiseOwner
```

**Step 3: Commit**

```bash
git add src/server/RentalLocation.luau src/server/Careers/FranchiseOwner.luau
git commit -m "feat: add Franchise Owner career with location purchase and revenue"
```

---

### Task 9: Remaining Careers (Shuttle Driver, Transporter, Sales Rep)

**Files:**
- Create: `src/server/Careers/ShuttleDriver.luau`
- Create: `src/server/Careers/CarTransporter.luau`
- Create: `src/server/Careers/SalesRep.luau`

**Step 1: Write Shuttle Driver**

```lua
-- src/server/Careers/ShuttleDriver.luau
local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local ShuttleDriver = {}
ShuttleDriver.__index = ShuttleDriver

local ROUTES = {
    { name = "Terminal A to Rental Lot", distance = 500, baseTime = 30 },
    { name = "Terminal B to Rental Lot", distance = 700, baseTime = 40 },
    { name = "Rental Lot to Terminal A", distance = 500, baseTime = 30 },
    { name = "Rental Lot to Terminal B", distance = 700, baseTime = 40 },
    { name = "Long-term Parking to Terminal", distance = 300, baseTime = 20 },
}

function ShuttleDriver.new(player: Player)
    local self = setmetatable({}, ShuttleDriver)
    self.player = player
    self.currentRoute = nil
    self.passengers = 0
    self.tripsCompleted = 0
    self.rating = 5.0 -- 1-5 star rating
    return self
end

function ShuttleDriver:getNextRoute()
    return ROUTES[math.random(1, #ROUTES)]
end

function ShuttleDriver:startTrip(route)
    self.currentRoute = route
    self.passengers = math.random(1, 12) -- Shuttle capacity
end

function ShuttleDriver:completeTrip(arrivedOnTime: boolean)
    if not self.currentRoute then return end

    local payConfig = EconomyConfig.CAREER_PAY.ShuttleDriver
    local pay = payConfig.base

    -- Tips from passengers
    for i = 1, self.passengers do
        if math.random() < payConfig.tipChance then
            local tip = math.random(payConfig.tipRange[1], payConfig.tipRange[2])
            pay = pay + tip
        end
    end

    -- On-time bonus
    if arrivedOnTime then
        pay = pay + 5
        self.rating = math.min(5.0, self.rating + 0.01)
    else
        self.rating = math.max(1.0, self.rating - 0.05)
    end

    EconomySystem.payPlayer(self.player, pay, "Shuttle trip completed")
    EconomySystem.addXP(self.player, 10)
    self.tripsCompleted = self.tripsCompleted + 1
    self.currentRoute = nil
end

return ShuttleDriver
```

**Step 2: Write Car Transporter**

```lua
-- src/server/Careers/CarTransporter.luau
local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local CarTransporter = {}
CarTransporter.__index = CarTransporter

function CarTransporter.new(player: Player)
    local self = setmetatable({}, CarTransporter)
    self.player = player
    self.currentHaul = nil
    self.deliveriesCompleted = 0
    self.truckCapacity = 3 -- Cars per trip, upgradeable
    return self
end

function CarTransporter:loadCars(cars: {string}): boolean
    if #cars > self.truckCapacity then return false end
    self.currentHaul = {
        cars = cars,
        startTime = tick(),
    }
    return true
end

function CarTransporter:completeDelivery(damageCount: number)
    if not self.currentHaul then return end

    local payConfig = EconomyConfig.CAREER_PAY.CarTransporter
    local pay = payConfig.base
    local bonus = payConfig.bonusPerDelivery * #self.currentHaul.cars

    -- Penalty for damaged cars
    if damageCount > 0 then
        bonus = bonus - (20 * damageCount)
    end

    pay = pay + math.max(0, bonus)

    EconomySystem.payPlayer(self.player, pay, "Delivery: " .. #self.currentHaul.cars .. " cars")
    EconomySystem.addXP(self.player, 20 * #self.currentHaul.cars)
    self.deliveriesCompleted = self.deliveriesCompleted + 1
    self.currentHaul = nil
end

function CarTransporter:upgradeTruck(): boolean
    if self.truckCapacity >= 8 then return false end
    local cost = self.truckCapacity * 5000
    if EconomySystem.chargePlayer(self.player, cost) then
        self.truckCapacity = self.truckCapacity + 1
        return true
    end
    return false
end

return CarTransporter
```

**Step 3: Write Sales Rep**

```lua
-- src/server/Careers/SalesRep.luau
local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local SalesRep = {}
SalesRep.__index = SalesRep

local CONTRACT_TYPES = {
    { name = "Small Business", value = 500, difficulty = 1, duration = 7 },
    { name = "Corporate Fleet", value = 2000, difficulty = 3, duration = 30 },
    { name = "Hotel Partnership", value = 1500, difficulty = 2, duration = 14 },
    { name = "Airport Exclusive", value = 5000, difficulty = 4, duration = 60 },
    { name = "Convention Center", value = 3000, difficulty = 3, duration = 7 },
}

function SalesRep.new(player: Player)
    local self = setmetatable({}, SalesRep)
    self.player = player
    self.activeContracts = {}
    self.charm = 1 -- 1-10, affects negotiation success
    self.totalContractValue = 0
    return self
end

function SalesRep:getAvailableContracts(): {any}
    local available = {}
    for _, contract in ipairs(CONTRACT_TYPES) do
        if contract.difficulty <= math.ceil(self.charm / 2.5) then
            table.insert(available, contract)
        end
    end
    return available
end

function SalesRep:negotiate(contractIndex: number): boolean
    local contract = CONTRACT_TYPES[contractIndex]
    if not contract then return false end

    -- Success chance based on charm vs difficulty
    local successChance = math.min(0.9, 0.4 + (self.charm * 0.06) - (contract.difficulty * 0.1))
    if math.random() > successChance then
        return false -- Failed negotiation
    end

    -- Commission
    local payConfig = EconomyConfig.CAREER_PAY.SalesRep
    local commission = math.floor(contract.value * payConfig.commissionRate)
    local pay = payConfig.base + commission

    EconomySystem.payPlayer(self.player, pay, "Contract: " .. contract.name)
    EconomySystem.addXP(self.player, contract.difficulty * 25)

    table.insert(self.activeContracts, {
        name = contract.name,
        value = contract.value,
        daysRemaining = contract.duration,
    })

    self.totalContractValue = self.totalContractValue + contract.value

    -- Level up charm every 5 contracts
    if #self.activeContracts % 5 == 0 and self.charm < 10 then
        self.charm = self.charm + 1
    end

    return true
end

return SalesRep
```

**Step 4: Commit**

```bash
git add src/server/Careers/
git commit -m "feat: add Shuttle Driver, Car Transporter, and Sales Rep careers"
```

---

### Task 9b: Career Gameplay - Food Court Worker & Janitor

**Files:**
- Create: `src/server/Careers/FoodCourtWorker.luau`
- Create: `src/server/Careers/Janitor.luau`

**Step 1: Write Food Court Worker**

```lua
-- src/server/Careers/FoodCourtWorker.luau
local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local FoodCourtWorker = {}
FoodCourtWorker.__index = FoodCourtWorker

local MENU_ITEMS = {
    { name = "Burger", prepTime = 5, price = 8, difficulty = 1 },
    { name = "Pizza Slice", prepTime = 3, price = 5, difficulty = 1 },
    { name = "Chicken Sandwich", prepTime = 7, price = 10, difficulty = 2 },
    { name = "Salad Bowl", prepTime = 4, price = 9, difficulty = 1 },
    { name = "Steak Plate", prepTime = 12, price = 18, difficulty = 3 },
    { name = "Sushi Roll", prepTime = 10, price = 14, difficulty = 3 },
    { name = "Tacos", prepTime = 6, price = 9, difficulty = 2 },
    { name = "Coffee", prepTime = 2, price = 4, difficulty = 1 },
}

function FoodCourtWorker.new(player: Player)
    local self = setmetatable({}, FoodCourtWorker)
    self.player = player
    self.isWorking = false
    self.ordersCompleted = 0
    self.cookingSkill = 1 -- 1-10, reduces prep time
    self.currentOrder = nil
    self.streak = 0 -- Consecutive orders without mistakes
    return self
end

function FoodCourtWorker:getNextOrder(): any
    local numItems = math.random(1, 3)
    local order = {
        items = {},
        customerPatience = math.random(20, 60), -- Seconds to complete
        tip = 0,
    }
    for i = 1, numItems do
        local item = MENU_ITEMS[math.random(1, #MENU_ITEMS)]
        if item.difficulty <= math.ceil(self.cookingSkill / 3) + 1 then
            table.insert(order.items, item)
        else
            table.insert(order.items, MENU_ITEMS[1]) -- Default to burger
        end
    end
    self.currentOrder = order
    return order
end

function FoodCourtWorker:completeOrder(timeTaken: number): number
    if not self.currentOrder then return 0 end

    local payConfig = EconomyConfig.CAREER_PAY.FoodCourtWorker
    local pay = payConfig.base

    -- Speed bonus
    local totalPrepTime = 0
    for _, item in ipairs(self.currentOrder.items) do
        totalPrepTime = totalPrepTime + (item.prepTime / (1 + self.cookingSkill * 0.1))
    end

    if timeTaken <= totalPrepTime then
        pay = pay + 5 -- Speed bonus
        self.streak = self.streak + 1
    else
        self.streak = 0
    end

    -- Streak bonus
    if self.streak >= 5 then
        pay = pay + self.streak * 2
    end

    -- Tip
    if math.random() < payConfig.tipChance then
        local tip = math.random(payConfig.tipRange[1], payConfig.tipRange[2])
        pay = pay + tip
    end

    EconomySystem.payPlayer(self.player, pay, "Order completed")
    EconomySystem.addXP(self.player, 10 * #self.currentOrder.items)

    self.ordersCompleted = self.ordersCompleted + 1
    -- Skill up every 15 orders
    if self.ordersCompleted % 15 == 0 and self.cookingSkill < 10 then
        self.cookingSkill = self.cookingSkill + 1
    end

    self.currentOrder = nil
    return pay
end

return FoodCourtWorker
```

**Step 2: Write Janitor**

```lua
-- src/server/Careers/Janitor.luau
local EconomySystem = require(script.Parent.Parent.EconomySystem)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)

local Janitor = {}
Janitor.__index = Janitor

local CLEANING_TASKS = {
    { name = "Mop Floor", duration = 8, xp = 5, area = "any" },
    { name = "Empty Trash", duration = 5, xp = 3, area = "any" },
    { name = "Clean Restroom", duration = 15, xp = 12, area = "any" },
    { name = "Wipe Counters", duration = 6, xp = 4, area = "rental_counter" },
    { name = "Vacuum Carpet", duration = 10, xp = 7, area = "terminal" },
    { name = "Clean Windows", duration = 12, xp = 8, area = "any" },
    { name = "Polish Cars", duration = 20, xp = 15, area = "rental_lot" },
    { name = "Pressure Wash", duration = 25, xp = 20, area = "parking" },
    { name = "Snow Removal", duration = 30, xp = 25, area = "outdoor" },
}

local LOCATIONS = {
    { name = "Airport Terminal A", areas = {"terminal", "any"}, dirtRate = 5 },
    { name = "Airport Terminal B", areas = {"terminal", "any"}, dirtRate = 4 },
    { name = "Rental Car Center", areas = {"rental_counter", "rental_lot", "any"}, dirtRate = 3 },
    { name = "Easton Mall Food Court", areas = {"any"}, dirtRate = 6 },
    { name = "Downtown Office", areas = {"any"}, dirtRate = 2 },
    { name = "Parking Garage", areas = {"parking", "any"}, dirtRate = 2 },
}

function Janitor.new(player: Player)
    local self = setmetatable({}, Janitor)
    self.player = player
    self.isWorking = false
    self.currentLocation = nil
    self.areasCleanedToday = 0
    self.cleaningSpeed = 1 -- 1-10, multiplier on duration
    self.currentTask = nil
    return self
end

function Janitor:assignLocation(locationIndex: number)
    if locationIndex > 0 and locationIndex <= #LOCATIONS then
        self.currentLocation = LOCATIONS[locationIndex]
    end
end

function Janitor:getAvailableTasks(): {any}
    if not self.currentLocation then return {} end
    local tasks = {}
    for _, task in ipairs(CLEANING_TASKS) do
        if task.area == "any" or table.find(self.currentLocation.areas, task.area) then
            table.insert(tasks, {
                name = task.name,
                duration = math.floor(task.duration / (1 + self.cleaningSpeed * 0.08)),
                xp = task.xp,
            })
        end
    end
    return tasks
end

function Janitor:startTask(taskName: string): boolean
    for _, task in ipairs(CLEANING_TASKS) do
        if task.name == taskName then
            self.currentTask = {
                name = taskName,
                config = task,
                startTime = tick(),
                duration = task.duration / (1 + self.cleaningSpeed * 0.08),
            }
            return true
        end
    end
    return false
end

function Janitor:completeTask(): number
    if not self.currentTask then return 0 end

    local payConfig = EconomyConfig.CAREER_PAY.Janitor
    local pay = payConfig.base + payConfig.cleaningBonus

    EconomySystem.payPlayer(self.player, pay, "Cleaned: " .. self.currentTask.name)
    EconomySystem.addXP(self.player, self.currentTask.config.xp)

    self.areasCleanedToday = self.areasCleanedToday + 1

    -- Bonus for cleaning multiple areas in a row
    if self.areasCleanedToday % 5 == 0 then
        local bonus = 25
        EconomySystem.payPlayer(self.player, bonus, "Cleaning streak bonus!")
    end

    -- Skill up every 20 tasks
    if self.areasCleanedToday % 20 == 0 and self.cleaningSpeed < 10 then
        self.cleaningSpeed = self.cleaningSpeed + 1
    end

    self.currentTask = nil
    return pay
end

return Janitor
```

**Step 3: Commit**

```bash
git add src/server/Careers/FoodCourtWorker.luau src/server/Careers/Janitor.luau
git commit -m "feat: add Food Court Worker and Janitor careers"
```

---

## Phase 3: Columbus Ohio MVP Map

### Task 10: City Layout & Landmarks

**Files:**
- Create: `src/shared/CityData/Columbus.luau`
- Create: `src/server/CityManager.luau`

**Step 1: Define Columbus city data**

```lua
-- src/shared/CityData/Columbus.luau
local Columbus = {}

Columbus.NAME = "Columbus"
Columbus.STATE = "Ohio"
Columbus.AIRPORT_CODE = "CMH"
Columbus.AIRPORT_NAME = "John Glenn Columbus International Airport"

-- Key districts/neighborhoods (relative positions for map layout)
Columbus.DISTRICTS = {
    {
        name = "Airport District",
        position = Vector3.new(2000, 0, 0),
        size = Vector3.new(800, 0, 600),
        type = "airport",
        landmarks = {"John Glenn International Airport", "Airport Rental Car Center"},
    },
    {
        name = "Downtown",
        position = Vector3.new(0, 0, 0),
        size = Vector3.new(600, 0, 600),
        type = "urban",
        landmarks = {"Ohio Statehouse", "Columbus Commons", "Nationwide Arena"},
    },
    {
        name = "Short North Arts District",
        position = Vector3.new(0, 0, -400),
        size = Vector3.new(300, 0, 400),
        type = "commercial",
        landmarks = {"North Market", "Gallery Hop", "Short North Arches"},
    },
    {
        name = "German Village",
        position = Vector3.new(200, 0, 500),
        size = Vector3.new(400, 0, 300),
        type = "residential",
        landmarks = {"Schiller Park", "Book Loft", "Schmidt's Restaurant"},
    },
    {
        name = "Ohio State University",
        position = Vector3.new(-600, 0, -400),
        size = Vector3.new(500, 0, 500),
        type = "campus",
        landmarks = {"Ohio Stadium", "The Oval", "Mirror Lake"},
    },
    {
        name = "Easton Town Center",
        position = Vector3.new(1200, 0, -300),
        size = Vector3.new(400, 0, 400),
        type = "shopping",
        landmarks = {"Easton Mall", "AMC Theater", "Nordstrom"},
    },
    {
        name = "Polaris",
        position = Vector3.new(-400, 0, -1000),
        size = Vector3.new(400, 0, 300),
        type = "suburban",
        landmarks = {"Polaris Fashion Place", "Funny Bone Comedy Club"},
    },
    {
        name = "Arena District",
        position = Vector3.new(-200, 0, -100),
        size = Vector3.new(300, 0, 300),
        type = "entertainment",
        landmarks = {"Nationwide Arena", "Huntington Park", "Express Live"},
    },
}

-- Rental location slots (where players can build)
Columbus.RENTAL_SLOTS = {
    { name = "Airport Lot A", position = Vector3.new(2100, 0, 50), isAirport = true, cost = 100000 },
    { name = "Airport Lot B", position = Vector3.new(2100, 0, -50), isAirport = true, cost = 100000 },
    { name = "Downtown Location", position = Vector3.new(50, 0, 100), isAirport = false, cost = 50000 },
    { name = "Easton Location", position = Vector3.new(1250, 0, -250), isAirport = false, cost = 35000 },
    { name = "OSU Campus Lot", position = Vector3.new(-550, 0, -350), isAirport = false, cost = 25000 },
    { name = "German Village Lot", position = Vector3.new(250, 0, 450), isAirport = false, cost = 30000 },
    { name = "Polaris Location", position = Vector3.new(-350, 0, -950), isAirport = false, cost = 40000 },
}

-- Road network (connections between districts)
Columbus.ROADS = {
    { from = "Downtown", to = "Airport District", lanes = 3, speedLimit = 65 },
    { from = "Downtown", to = "Short North Arts District", lanes = 2, speedLimit = 35 },
    { from = "Downtown", to = "German Village", lanes = 2, speedLimit = 35 },
    { from = "Downtown", to = "Arena District", lanes = 2, speedLimit = 35 },
    { from = "Downtown", to = "Ohio State University", lanes = 2, speedLimit = 45 },
    { from = "Downtown", to = "Easton Town Center", lanes = 3, speedLimit = 55 },
    { from = "Airport District", to = "Easton Town Center", lanes = 2, speedLimit = 55 },
    { from = "Short North Arts District", to = "Ohio State University", lanes = 2, speedLimit = 35 },
    { from = "Ohio State University", to = "Polaris", lanes = 3, speedLimit = 55 },
    { from = "Easton Town Center", to = "Polaris", lanes = 2, speedLimit = 55 },
}

return Columbus
```

**Step 2: Write city manager**

```lua
-- src/server/CityManager.luau
local CityManager = {}
CityManager.__index = CityManager

local activeCities = {}

function CityManager.loadCity(cityModule)
    local city = {
        data = cityModule,
        activeLocations = {}, -- Player-owned rental spots
        npcTraffic = {},
        weather = "Clear",
    }
    activeCities[cityModule.NAME] = city
    return city
end

function CityManager.getCity(name: string)
    return activeCities[name]
end

function CityManager.getDistrict(cityName: string, districtName: string)
    local city = activeCities[cityName]
    if not city then return nil end
    for _, district in ipairs(city.data.DISTRICTS) do
        if district.name == districtName then
            return district
        end
    end
    return nil
end

function CityManager.getRentalSlots(cityName: string): {any}
    local city = activeCities[cityName]
    if not city then return {} end
    return city.data.RENTAL_SLOTS
end

function CityManager.claimSlot(cityName: string, slotName: string, playerId: number): boolean
    local city = activeCities[cityName]
    if not city then return false end

    for _, slot in ipairs(city.data.RENTAL_SLOTS) do
        if slot.name == slotName and not slot.owner then
            slot.owner = playerId
            return true
        end
    end
    return false
end

return CityManager
```

**Step 3: Commit**

```bash
git add src/shared/CityData/ src/server/CityManager.luau
git commit -m "feat: add Columbus Ohio city layout with districts, roads, and rental slots"
```

---

### Task 11: Airport System

**Files:**
- Create: `src/server/AirportSystem.luau`
- Create: `src/shared/AirportConfig.luau`

**Step 1: Write airport configuration**

```lua
-- src/shared/AirportConfig.luau
local AirportConfig = {}

AirportConfig.TERMINALS = {
    { name = "Terminal A", gates = 12, airlines = {"Delta", "United", "American"} },
    { name = "Terminal B", gates = 8, airlines = {"Southwest", "Frontier", "Spirit"} },
}

AirportConfig.FLIGHT_FREQUENCY = {
    peak = 5, -- Flights per game-hour during peak (6AM-10AM, 4PM-8PM)
    offpeak = 2, -- Flights per game-hour off-peak
    night = 0.5, -- Flights per game-hour at night
}

-- Passengers per flight (affects shuttle demand and rental customers)
AirportConfig.PASSENGERS_PER_FLIGHT = {
    min = 80,
    max = 200,
}

-- Percentage of arriving passengers who need a rental
AirportConfig.RENTAL_DEMAND_RATE = 0.15

return AirportConfig
```

**Step 2: Write airport system**

```lua
-- src/server/AirportSystem.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local AirportConfig = require(game.ReplicatedStorage.Shared.AirportConfig)
local TimeSystem = require(script.Parent.TimeSystem)
local Constants = require(game.ReplicatedStorage.Shared.Constants)

local AirportSystem = {}
AirportSystem.__index = AirportSystem

local activeFlights = {}
local passengerQueue = {} -- People needing rentals

function AirportSystem.init()
    -- Spawn flight arrivals based on time of day
    task.spawn(function()
        while true do
            local hour = TimeSystem.getGameTime()
            local frequency
            if (hour >= 6 and hour <= 10) or (hour >= 16 and hour <= 20) then
                frequency = AirportConfig.FLIGHT_FREQUENCY.peak
            elseif hour >= 22 or hour <= 5 then
                frequency = AirportConfig.FLIGHT_FREQUENCY.night
            else
                frequency = AirportConfig.FLIGHT_FREQUENCY.offpeak
            end

            -- Wait time between flights (in real seconds)
            local gameSecondsPerFlight = 3600 / frequency
            local realWait = gameSecondsPerFlight / Constants.TIME_MULTIPLIER

            task.wait(math.max(5, realWait)) -- Min 5 real seconds between flights
            AirportSystem.spawnFlight()
        end
    end)
end

function AirportSystem.spawnFlight()
    local terminal = AirportConfig.TERMINALS[math.random(1, #AirportConfig.TERMINALS)]
    local airline = terminal.airlines[math.random(1, #terminal.airlines)]
    local passengers = math.random(
        AirportConfig.PASSENGERS_PER_FLIGHT.min,
        AirportConfig.PASSENGERS_PER_FLIGHT.max
    )

    local flight = {
        airline = airline,
        terminal = terminal.name,
        passengers = passengers,
        arrivalTime = tick(),
        flightNumber = airline:sub(1, 2):upper() .. tostring(math.random(100, 9999)),
    }

    table.insert(activeFlights, flight)

    -- Generate rental customers from this flight
    local rentalCustomers = math.floor(passengers * AirportConfig.RENTAL_DEMAND_RATE)
    for i = 1, rentalCustomers do
        table.insert(passengerQueue, {
            origin = flight.flightNumber,
            terminal = terminal.name,
            spawnTime = tick() + math.random(0, 120), -- Stagger arrivals
        })
    end

    -- Notify shuttle drivers
    local shuttleEvent = ReplicatedStorage:FindFirstChild("ShuttleNeeded")
    if shuttleEvent then
        shuttleEvent:FireAllClients(terminal.name, passengers)
    end
end

function AirportSystem.getNextPassenger(): any?
    if #passengerQueue == 0 then return nil end
    return table.remove(passengerQueue, 1)
end

function AirportSystem.getActiveFlights(): {any}
    return activeFlights
end

return AirportSystem
```

**Step 3: Commit**

```bash
git add src/shared/AirportConfig.luau src/server/AirportSystem.luau
git commit -m "feat: add airport system with flight arrivals and passenger demand"
```

---

## Phase 4: NPC AI System

### Task 12: AI Behavior Tree Framework

**Files:**
- Create: `src/server/AI/BehaviorTree.luau`
- Create: `src/server/AI/NPCManager.luau`

**Step 1: Write behavior tree engine**

```lua
-- src/server/AI/BehaviorTree.luau
local BehaviorTree = {}
BehaviorTree.__index = BehaviorTree

export type NodeStatus = "success" | "failure" | "running"

-- Base Node
local Node = {}
Node.__index = Node

function Node.new(name: string)
    return setmetatable({ name = name, children = {} }, Node)
end

-- Sequence: runs children in order, fails if any child fails
local Sequence = setmetatable({}, { __index = Node })
Sequence.__index = Sequence

function Sequence.new(name: string, children: {any})
    local self = setmetatable(Node.new(name), Sequence)
    self.children = children
    self.currentIndex = 1
    return self
end

function Sequence:tick(context): NodeStatus
    while self.currentIndex <= #self.children do
        local status = self.children[self.currentIndex]:tick(context)
        if status == "failure" then
            self.currentIndex = 1
            return "failure"
        elseif status == "running" then
            return "running"
        end
        self.currentIndex = self.currentIndex + 1
    end
    self.currentIndex = 1
    return "success"
end

-- Selector: tries children until one succeeds
local Selector = setmetatable({}, { __index = Node })
Selector.__index = Selector

function Selector.new(name: string, children: {any})
    local self = setmetatable(Node.new(name), Selector)
    self.children = children
    return self
end

function Selector:tick(context): NodeStatus
    for _, child in ipairs(self.children) do
        local status = child:tick(context)
        if status ~= "failure" then
            return status
        end
    end
    return "failure"
end

-- Action: leaf node that performs an action
local Action = setmetatable({}, { __index = Node })
Action.__index = Action

function Action.new(name: string, fn: (any) -> NodeStatus)
    local self = setmetatable(Node.new(name), Action)
    self.fn = fn
    return self
end

function Action:tick(context): NodeStatus
    return self.fn(context)
end

-- Condition: leaf node that checks a condition
local Condition = setmetatable({}, { __index = Node })
Condition.__index = Condition

function Condition.new(name: string, fn: (any) -> boolean)
    local self = setmetatable(Node.new(name), Condition)
    self.fn = fn
    return self
end

function Condition:tick(context): NodeStatus
    return self.fn(context) and "success" or "failure"
end

BehaviorTree.Sequence = Sequence
BehaviorTree.Selector = Selector
BehaviorTree.Action = Action
BehaviorTree.Condition = Condition

return BehaviorTree
```

**Step 2: Write NPC Manager**

```lua
-- src/server/AI/NPCManager.luau
local RunService = game:GetService("RunService")
local PathfindingService = game:GetService("PathfindingService")

local BehaviorTree = require(script.Parent.BehaviorTree)
local Constants = require(game.ReplicatedStorage.Shared.Constants)

local NPCManager = {}
NPCManager.__index = NPCManager

local activeNPCs = {}
local NPC_UPDATE_RATE = 0.5 -- Seconds between AI ticks

export type NPCPersonality = {
    name: string,
    patience: number, -- 1-10
    generosity: number, -- 1-10 (tip likelihood)
    talkativeness: number, -- 1-10
    budgetLevel: number, -- 1-5 (1=budget, 5=luxury)
    preferredCarClass: string,
}

local PERSONALITY_PRESETS = {
    Friendly = { patience = 8, generosity = 7, talkativeness = 9, budgetLevel = 3 },
    Impatient = { patience = 2, generosity = 3, talkativeness = 4, budgetLevel = 4 },
    Indecisive = { patience = 6, generosity = 5, talkativeness = 7, budgetLevel = 2 },
    Business = { patience = 4, generosity = 6, talkativeness = 3, budgetLevel = 5 },
    Tourist = { patience = 7, generosity = 8, talkativeness = 8, budgetLevel = 3 },
    Budget = { patience = 5, generosity = 2, talkativeness = 5, budgetLevel = 1 },
}

function NPCManager.init()
    -- Update NPCs on a fixed interval
    task.spawn(function()
        while true do
            task.wait(NPC_UPDATE_RATE)
            for _, npc in ipairs(activeNPCs) do
                if npc.behaviorTree then
                    npc.behaviorTree:tick(npc.context)
                end
            end
        end
    end)
end

function NPCManager.spawnNPC(config: {
    position: Vector3,
    personalityType: string,
    role: string, -- "customer", "employee", "pedestrian"
    destination: Vector3?,
}): any
    local personality = PERSONALITY_PRESETS[config.personalityType] or PERSONALITY_PRESETS.Friendly

    -- Create NPC model (humanoid)
    local npcModel = Instance.new("Model")
    npcModel.Name = "NPC_" .. #activeNPCs + 1

    local humanoid = Instance.new("Humanoid")
    humanoid.Parent = npcModel

    local rootPart = Instance.new("Part")
    rootPart.Name = "HumanoidRootPart"
    rootPart.Size = Vector3.new(2, 2, 1)
    rootPart.Position = config.position
    rootPart.Anchored = false
    rootPart.Parent = npcModel
    npcModel.PrimaryPart = rootPart

    npcModel.Parent = workspace:FindFirstChild("NPCs") or workspace

    local npc = {
        model = npcModel,
        personality = personality,
        personalityType = config.personalityType,
        role = config.role,
        context = {
            model = npcModel,
            personality = personality,
            destination = config.destination,
            state = "idle",
            waitTime = 0,
        },
        behaviorTree = nil,
    }

    -- Assign behavior tree based on role
    if config.role == "customer" then
        npc.behaviorTree = NPCManager.createCustomerBehavior()
    elseif config.role == "pedestrian" then
        npc.behaviorTree = NPCManager.createPedestrianBehavior()
    end

    table.insert(activeNPCs, npc)
    return npc
end

function NPCManager.createCustomerBehavior()
    return BehaviorTree.Sequence.new("CustomerBehavior", {
        BehaviorTree.Action.new("WalkToCounter", function(ctx)
            if not ctx.destination then return "failure" end
            -- Pathfind to rental counter
            local path = PathfindingService:CreatePath()
            path:ComputeAsync(ctx.model.PrimaryPart.Position, ctx.destination)
            if path.Status == Enum.PathStatus.Success then
                local waypoints = path:GetWaypoints()
                for _, wp in ipairs(waypoints) do
                    ctx.model.Humanoid:MoveTo(wp.Position)
                    ctx.model.Humanoid.MoveToFinished:Wait()
                end
                return "success"
            end
            return "failure"
        end),
        BehaviorTree.Action.new("WaitInLine", function(ctx)
            ctx.state = "waiting"
            ctx.waitTime = ctx.waitTime + NPC_UPDATE_RATE
            -- Impatient NPCs leave after waiting too long
            local maxWait = ctx.personality.patience * 10 -- seconds
            if ctx.waitTime > maxWait then
                ctx.state = "leaving"
                return "failure"
            end
            return "running"
        end),
        BehaviorTree.Action.new("InteractWithAgent", function(ctx)
            ctx.state = "interacting"
            return "running" -- Waits for player interaction
        end),
    })
end

function NPCManager.createPedestrianBehavior()
    return BehaviorTree.Sequence.new("PedestrianBehavior", {
        BehaviorTree.Action.new("Wander", function(ctx)
            -- Pick random nearby point and walk to it
            local offset = Vector3.new(math.random(-50, 50), 0, math.random(-50, 50))
            local target = ctx.model.PrimaryPart.Position + offset
            ctx.model.Humanoid:MoveTo(target)
            return "success"
        end),
        BehaviorTree.Action.new("Wait", function(ctx)
            task.wait(math.random(3, 10))
            return "success"
        end),
    })
end

function NPCManager.despawnNPC(npc)
    if npc.model then
        npc.model:Destroy()
    end
    local idx = table.find(activeNPCs, npc)
    if idx then
        table.remove(activeNPCs, idx)
    end
end

function NPCManager.getNPCCount(): number
    return #activeNPCs
end

return NPCManager
```

**Step 3: Commit**

```bash
git add src/server/AI/
git commit -m "feat: add NPC AI with behavior trees, personalities, and pathfinding"
```

---

### Task 13: Hireable NPC Employees

**Files:**
- Create: `src/server/AI/EmployeeNPC.luau`

**Step 1: Write hireable employee system**

```lua
-- src/server/AI/EmployeeNPC.luau
local NPCManager = require(script.Parent.NPCManager)

local EmployeeNPC = {}
EmployeeNPC.__index = EmployeeNPC

local EMPLOYEE_NAMES = {
    "Alex", "Jordan", "Sam", "Casey", "Morgan",
    "Riley", "Taylor", "Avery", "Quinn", "Parker",
    "Dakota", "Reese", "Skyler", "Jamie", "Drew",
}

local EMPLOYEE_TRAITS = {
    { trait = "Fast Learner", effect = { xpMultiplier = 1.5 } },
    { trait = "People Person", effect = { customerSatisfaction = 1.2 } },
    { trait = "Detail Oriented", effect = { repairQuality = 1.3 } },
    { trait = "Hard Worker", effect = { speedMultiplier = 1.2 } },
    { trait = "Lazy", effect = { speedMultiplier = 0.8 } },
    { trait = "Clumsy", effect = { damageChance = 0.1 } },
    { trait = "Charming", effect = { tipMultiplier = 1.5 } },
    { trait = "Punctual", effect = { lateChance = 0 } },
}

function EmployeeNPC.generate(): any
    local name = EMPLOYEE_NAMES[math.random(1, #EMPLOYEE_NAMES)]
    local numTraits = math.random(1, 3)
    local traits = {}
    local usedIndices = {}

    for i = 1, numTraits do
        local idx
        repeat
            idx = math.random(1, #EMPLOYEE_TRAITS)
        until not usedIndices[idx]
        usedIndices[idx] = true
        table.insert(traits, EMPLOYEE_TRAITS[idx])
    end

    -- Salary based on traits (better traits = higher salary demand)
    local baseSalary = math.random(10, 18) -- Per game-hour
    local salaryModifier = 1.0
    for _, t in ipairs(traits) do
        if t.effect.speedMultiplier and t.effect.speedMultiplier > 1 then
            salaryModifier = salaryModifier + 0.2
        end
        if t.effect.speedMultiplier and t.effect.speedMultiplier < 1 then
            salaryModifier = salaryModifier - 0.15
        end
    end

    return {
        name = name,
        traits = traits,
        salary = math.floor(baseSalary * salaryModifier),
        efficiency = salaryModifier,
        morale = 80, -- 0-100
        daysEmployed = 0,
        role = "counter", -- counter, mechanic, cleaner
    }
end

function EmployeeNPC.generatePool(count: number): {any}
    local pool = {}
    for i = 1, count do
        table.insert(pool, EmployeeNPC.generate())
    end
    return pool
end

function EmployeeNPC.updateMorale(employee, factors: { paid: boolean, overworked: boolean, praised: boolean })
    if factors.paid then employee.morale = math.min(100, employee.morale + 5) end
    if factors.overworked then employee.morale = math.max(0, employee.morale - 10) end
    if factors.praised then employee.morale = math.min(100, employee.morale + 15) end

    -- Low morale = chance to quit
    if employee.morale < 20 then
        return math.random() < 0.1 -- 10% chance to quit per check
    end
    return false
end

return EmployeeNPC
```

**Step 2: Commit**

```bash
git add src/server/AI/EmployeeNPC.luau
git commit -m "feat: add hireable NPC employees with traits, morale, and salary"
```

---

## Phase 5: Vehicle System

### Task 14: Car Models & Driving Physics

**Files:**
- Create: `src/shared/VehicleConfig.luau`
- Create: `src/server/VehicleSystem.luau`

**Step 1: Write vehicle configuration**

```lua
-- src/shared/VehicleConfig.luau
local VehicleConfig = {}

VehicleConfig.VEHICLES = {
    -- Economy
    ToyotaCorolla = { class = "Economy", speed = 120, handling = 7, fuel = 50, seats = 5, trunk = 3 },
    HondaCivic = { class = "Economy", speed = 125, handling = 7, fuel = 42, seats = 5, trunk = 3 },
    NissanSentra = { class = "Economy", speed = 118, handling = 6, fuel = 45, seats = 5, trunk = 3 },

    -- Compact
    Mazda3 = { class = "Compact", speed = 130, handling = 8, fuel = 42, seats = 5, trunk = 3 },
    VWJetta = { class = "Compact", speed = 128, handling = 7, fuel = 44, seats = 5, trunk = 3 },

    -- Midsize
    ToyotaCamry = { class = "Midsize", speed = 135, handling = 7, fuel = 53, seats = 5, trunk = 4 },
    HondaAccord = { class = "Midsize", speed = 138, handling = 8, fuel = 50, seats = 5, trunk = 4 },

    -- Full Size
    ChevyImpala = { class = "FullSize", speed = 140, handling = 6, fuel = 60, seats = 5, trunk = 5 },
    DodgeCharger = { class = "FullSize", speed = 155, handling = 7, fuel = 68, seats = 5, trunk = 4 },

    -- SUV
    FordExplorer = { class = "SUV", speed = 130, handling = 6, fuel = 75, seats = 7, trunk = 6 },
    ChevyTahoe = { class = "SUV", speed = 125, handling = 5, fuel = 85, seats = 8, trunk = 7 },

    -- Luxury
    BMW5Series = { class = "Luxury", speed = 160, handling = 9, fuel = 55, seats = 5, trunk = 4 },
    MercedesEClass = { class = "Luxury", speed = 155, handling = 9, fuel = 58, seats = 5, trunk = 4 },

    -- Exotic
    LamborghiniHuracan = { class = "Exotic", speed = 210, handling = 10, fuel = 70, seats = 2, trunk = 1 },
    Ferrari488 = { class = "Exotic", speed = 205, handling = 10, fuel = 68, seats = 2, trunk = 1 },

    -- Truck
    FordF150 = { class = "Truck", speed = 120, handling = 5, fuel = 90, seats = 5, trunk = 8 },
    RAM1500 = { class = "Truck", speed = 118, handling = 5, fuel = 95, seats = 5, trunk = 8 },
}

VehicleConfig.DAMAGE_TYPES = {
    Scratch = { repairCost = 50, severity = 1 },
    Dent = { repairCost = 150, severity = 2 },
    Bumper = { repairCost = 300, severity = 3 },
    Windshield = { repairCost = 250, severity = 3 },
    Engine = { repairCost = 1000, severity = 5 },
    Tire = { repairCost = 100, severity = 2 },
}

VehicleConfig.FUEL_COST_PER_GALLON = 3.50
VehicleConfig.INSURANCE_DAILY_RATE = 15

return VehicleConfig
```

**Step 2: Write vehicle system**

```lua
-- src/server/VehicleSystem.luau
local VehicleConfig = require(game.ReplicatedStorage.Shared.VehicleConfig)

local VehicleSystem = {}
VehicleSystem.__index = VehicleSystem

local activeVehicles = {}

export type VehicleInstance = {
    id: string,
    model: string,
    config: any,
    condition: number, -- 0-100
    fuel: number, -- 0-max
    mileage: number,
    damages: {string},
    isRented: boolean,
    renter: number?, -- Player UserId
    location: string,
}

function VehicleSystem.spawnVehicle(modelName: string, position: Vector3): VehicleInstance?
    local config = VehicleConfig.VEHICLES[modelName]
    if not config then return nil end

    local vehicle: VehicleInstance = {
        id = game:GetService("HttpService"):GenerateGUID(),
        model = modelName,
        config = config,
        condition = 100,
        fuel = config.fuel,
        mileage = 0,
        damages = {},
        isRented = false,
        renter = nil,
        location = "lot",
    }

    table.insert(activeVehicles, vehicle)
    return vehicle
end

function VehicleSystem.rentVehicle(vehicleId: string, playerId: number): boolean
    for _, v in ipairs(activeVehicles) do
        if v.id == vehicleId and not v.isRented then
            v.isRented = true
            v.renter = playerId
            return true
        end
    end
    return false
end

function VehicleSystem.returnVehicle(vehicleId: string): { damages: {string}, fuelUsed: number }
    for _, v in ipairs(activeVehicles) do
        if v.id == vehicleId then
            v.isRented = false
            local result = {
                damages = v.damages,
                fuelUsed = v.config.fuel - v.fuel,
            }
            v.renter = nil
            return result
        end
    end
    return { damages = {}, fuelUsed = 0 }
end

function VehicleSystem.addDamage(vehicleId: string, damageType: string)
    for _, v in ipairs(activeVehicles) do
        if v.id == vehicleId then
            table.insert(v.damages, damageType)
            local damageConfig = VehicleConfig.DAMAGE_TYPES[damageType]
            if damageConfig then
                v.condition = math.max(0, v.condition - (damageConfig.severity * 5))
            end
            return
        end
    end
end

function VehicleSystem.refuel(vehicleId: string): number
    for _, v in ipairs(activeVehicles) do
        if v.id == vehicleId then
            local gallonsNeeded = v.config.fuel - v.fuel
            v.fuel = v.config.fuel
            return gallonsNeeded * VehicleConfig.FUEL_COST_PER_GALLON
        end
    end
    return 0
end

function VehicleSystem.getAvailableVehicles(location: string, carClass: string?): {VehicleInstance}
    local available = {}
    for _, v in ipairs(activeVehicles) do
        if not v.isRented and v.location == location then
            if not carClass or v.config.class == carClass then
                table.insert(available, v)
            end
        end
    end
    return available
end

return VehicleSystem
```

**Step 3: Commit**

```bash
git add src/shared/VehicleConfig.luau src/server/VehicleSystem.luau
git commit -m "feat: add vehicle system with real car models, damage, and fuel tracking"
```

---

## Phase 6: Core Game Loop & Server Init

### Task 15: Server Initialization & Game Loop

**Files:**
- Create: `src/server/init.server.luau`

**Step 1: Write main server script**

```lua
-- src/server/init.server.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- Core systems
local DataManager = require(script.DataManager)
local TimeSystem = require(script.TimeSystem)
local EconomySystem = require(script.EconomySystem)
local CityManager = require(script.CityManager)
local AirportSystem = require(script.AirportSystem)
local VehicleSystem = require(script.VehicleSystem)

-- AI
local NPCManager = require(script.AI.NPCManager)

-- City data
local Columbus = require(game.ReplicatedStorage.Shared.CityData.Columbus)

-- Career modules
local RentalAgent = require(script.Careers.RentalAgent)
local Mechanic = require(script.Careers.Mechanic)
local FranchiseOwner = require(script.Careers.FranchiseOwner)
local ShuttleDriver = require(script.Careers.ShuttleDriver)
local CarTransporter = require(script.Careers.CarTransporter)
local SalesRep = require(script.Careers.SalesRep)
local FoodCourtWorker = require(script.Careers.FoodCourtWorker)
local Janitor = require(script.Careers.Janitor)

-- Create RemoteEvents
local function createRemotes()
    local events = {
        "CareerSelected", "CustomerArrived", "CustomerServed",
        "MoneyUpdate", "TimeSync", "ShuttleNeeded",
        "RepairStarted", "RepairCompleted", "VehicleRented",
        "VehicleReturned", "LocationPurchased",
    }
    for _, name in ipairs(events) do
        if not ReplicatedStorage:FindFirstChild(name) then
            local event = Instance.new("RemoteEvent")
            event.Name = name
            event.Parent = ReplicatedStorage
        end
    end

    local functions = {
        "GetPlayerData", "GetAvailableVehicles", "GetRentalSlots",
        "GetEmployeePool", "PurchaseLocation", "HireEmployee",
    }
    for _, name in ipairs(functions) do
        if not ReplicatedStorage:FindFirstChild(name) then
            local fn = Instance.new("RemoteFunction")
            fn.Name = name
            fn.Parent = ReplicatedStorage
        end
    end
end

-- Initialize all systems
local function init()
    print("[CarRentalEmpire] Initializing server...")

    createRemotes()
    TimeSystem.init()
    EconomySystem.init()
    NPCManager.init()

    -- Load Columbus
    CityManager.loadCity(Columbus)
    AirportSystem.init()

    -- Spawn initial fleet at airport
    for i = 1, 20 do
        local classes = {"Economy", "Compact", "Midsize", "FullSize", "SUV"}
        local class = classes[math.random(1, #classes)]
        local vehicles = {}
        for name, config in pairs(require(game.ReplicatedStorage.Shared.VehicleConfig).VEHICLES) do
            if config.class == class then
                table.insert(vehicles, name)
            end
        end
        if #vehicles > 0 then
            local modelName = vehicles[math.random(1, #vehicles)]
            local slot = Columbus.RENTAL_SLOTS[math.random(1, #Columbus.RENTAL_SLOTS)]
            VehicleSystem.spawnVehicle(modelName, slot.position)
        end
    end

    print("[CarRentalEmpire] Server initialized with Columbus, OH")
end

-- Player connections
local playerSessions = {} -- Active career sessions

Players.PlayerAdded:Connect(function(player)
    local data = DataManager.loadPlayerData(player)
    print("[CarRentalEmpire] " .. player.Name .. " joined. Career: " .. (data.career ~= "" and data.career or "None"))

    -- Handle career selection
    local careerEvent = ReplicatedStorage:FindFirstChild("CareerSelected")
    careerEvent.OnServerEvent:Connect(function(plr, career)
        if plr ~= player then return end
        DataManager.setCareer(player, career)

        -- Initialize career session
        if career == "RentalAgent" then
            playerSessions[player.UserId] = RentalAgent.new(player, "Airport Lot A")
        elseif career == "Mechanic" then
            playerSessions[player.UserId] = Mechanic.new(player)
        elseif career == "FranchiseOwner" then
            playerSessions[player.UserId] = FranchiseOwner.new(player)
        elseif career == "ShuttleDriver" then
            playerSessions[player.UserId] = ShuttleDriver.new(player)
        elseif career == "CarTransporter" then
            playerSessions[player.UserId] = CarTransporter.new(player)
        elseif career == "SalesRep" then
            playerSessions[player.UserId] = SalesRep.new(player)
        elseif career == "FoodCourtWorker" then
            playerSessions[player.UserId] = FoodCourtWorker.new(player)
        elseif career == "Janitor" then
            playerSessions[player.UserId] = Janitor.new(player)
        end
    end)

    -- Remote function handlers
    local getDataFn = ReplicatedStorage:FindFirstChild("GetPlayerData")
    getDataFn.OnServerInvoke = function(plr)
        if plr ~= player then return nil end
        return DataManager.getData(player)
    end
end)

Players.PlayerRemoving:Connect(function(player)
    DataManager.cleanup(player)
    playerSessions[player.UserId] = nil
end)

-- Auto-save every 5 minutes
task.spawn(function()
    while true do
        task.wait(300)
        for _, player in ipairs(Players:GetPlayers()) do
            DataManager.savePlayerData(player)
        end
    end
end)

-- Revenue collection for franchise owners (every game-hour)
task.spawn(function()
    while true do
        local realSecondsPerGameHour = 3600 / 7 -- ~514 real seconds
        task.wait(realSecondsPerGameHour)
        for userId, session in pairs(playerSessions) do
            if session.collectRevenue then
                session:collectRevenue()
            end
        end
    end
end)

init()
```

**Step 2: Commit**

```bash
git add src/server/init.server.luau
git commit -m "feat: add main server initialization with all systems wired together"
```

---

### Task 16: Client Initialization & HUD

**Files:**
- Create: `src/client/init.client.luau`
- Create: `src/ui/HUD.luau`

**Step 1: Write HUD**

```lua
-- src/ui/HUD.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local TimeUtils = require(game.ReplicatedStorage.Shared.TimeUtils)

local HUD = {}

function HUD.create(playerGui: PlayerGui): ScreenGui
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "GameHUD"
    screenGui.ResetOnSpawn = false
    screenGui.Parent = playerGui

    -- Top bar
    local topBar = Instance.new("Frame")
    topBar.Name = "TopBar"
    topBar.Size = UDim2.new(1, 0, 0, 40)
    topBar.Position = UDim2.new(0, 0, 0, 0)
    topBar.BackgroundColor3 = Color3.fromRGB(20, 20, 30)
    topBar.BackgroundTransparency = 0.3
    topBar.BorderSizePixel = 0
    topBar.Parent = screenGui

    -- Money display
    local moneyLabel = Instance.new("TextLabel")
    moneyLabel.Name = "MoneyLabel"
    moneyLabel.Size = UDim2.new(0.15, 0, 1, 0)
    moneyLabel.Position = UDim2.new(0.02, 0, 0, 0)
    moneyLabel.BackgroundTransparency = 1
    moneyLabel.Text = "$500"
    moneyLabel.TextColor3 = Color3.fromRGB(100, 255, 100)
    moneyLabel.TextScaled = true
    moneyLabel.Font = Enum.Font.GothamBold
    moneyLabel.TextXAlignment = Enum.TextXAlignment.Left
    moneyLabel.Parent = topBar

    -- Time display
    local timeLabel = Instance.new("TextLabel")
    timeLabel.Name = "TimeLabel"
    timeLabel.Size = UDim2.new(0.12, 0, 1, 0)
    timeLabel.Position = UDim2.new(0.44, 0, 0, 0)
    timeLabel.BackgroundTransparency = 1
    timeLabel.Text = "8:00 AM"
    timeLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
    timeLabel.TextScaled = true
    timeLabel.Font = Enum.Font.Gotham
    timeLabel.Parent = topBar

    -- Career/Level display
    local careerLabel = Instance.new("TextLabel")
    careerLabel.Name = "CareerLabel"
    careerLabel.Size = UDim2.new(0.2, 0, 1, 0)
    careerLabel.Position = UDim2.new(0.78, 0, 1, 0)
    careerLabel.BackgroundTransparency = 1
    careerLabel.Text = "No Career | Lv. 1"
    careerLabel.TextColor3 = Color3.fromRGB(200, 200, 255)
    careerLabel.TextScaled = true
    careerLabel.Font = Enum.Font.Gotham
    careerLabel.TextXAlignment = Enum.TextXAlignment.Right
    careerLabel.Parent = topBar

    -- Listen for money updates
    local moneyEvent = ReplicatedStorage:WaitForChild("MoneyUpdate")
    moneyEvent.OnClientEvent:Connect(function(newBalance, change, reason)
        moneyLabel.Text = "$" .. tostring(newBalance)
        -- Flash green/red for gain/loss
        if change > 0 then
            moneyLabel.TextColor3 = Color3.fromRGB(0, 255, 0)
        else
            moneyLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
        end
        task.delay(0.5, function()
            moneyLabel.TextColor3 = Color3.fromRGB(100, 255, 100)
        end)
    end)

    -- Listen for time sync
    local timeEvent = ReplicatedStorage:WaitForChild("TimeSync")
    timeEvent.OnClientEvent:Connect(function(hour, minute)
        timeLabel.Text = TimeUtils.formatTime(hour, minute)
    end)

    return screenGui
end

return HUD
```

**Step 2: Write client init**

```lua
-- src/client/init.client.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- UI Modules
local HUD = require(game.StarterGui.UI.HUD)
local CareerSelect = require(game.StarterGui.UI.CareerSelect)

-- Initialize HUD
local hud = HUD.create(playerGui)

-- Check if player has career
local getDataFn = ReplicatedStorage:WaitForChild("GetPlayerData")
local data = getDataFn:InvokeServer()

if not data or data.career == "" then
    -- Show career selection
    CareerSelect.show(playerGui, function(selectedCareer)
        local careerEvent = ReplicatedStorage:WaitForChild("CareerSelected")
        careerEvent:FireServer(selectedCareer)

        -- Update HUD
        local careerLabel = hud:FindFirstChild("TopBar"):FindFirstChild("CareerLabel")
        if careerLabel then
            careerLabel.Text = selectedCareer .. " | Lv. 1"
        end

        print("[Client] Career selected: " .. selectedCareer)
    end)
else
    -- Returning player, update HUD
    local careerLabel = hud:FindFirstChild("TopBar"):FindFirstChild("CareerLabel")
    if careerLabel then
        careerLabel.Text = data.career .. " | Lv. " .. tostring(data.level)
    end
    local moneyLabel = hud:FindFirstChild("TopBar"):FindFirstChild("MoneyLabel")
    if moneyLabel then
        moneyLabel.Text = "$" .. tostring(data.money)
    end
end
```

**Step 3: Commit**

```bash
git add src/client/init.client.luau src/ui/HUD.luau
git commit -m "feat: add client initialization with HUD and career selection flow"
```

---

## Phase 7: Vacation Mode

### Task 17: Vacation Mode System

**Files:**
- Create: `src/server/VacationMode.luau`
- Create: `src/shared/VacationConfig.luau`

**Step 1: Write vacation config**

```lua
-- src/shared/VacationConfig.luau
local VacationConfig = {}

VacationConfig.ACTIVITIES = {
    { name = "Visit Ohio Statehouse", xp = 20, cost = 0, district = "Downtown" },
    { name = "Explore Short North Galleries", xp = 15, cost = 10, district = "Short North Arts District" },
    { name = "Walk Schiller Park", xp = 10, cost = 0, district = "German Village" },
    { name = "Ohio State Campus Tour", xp = 25, cost = 0, district = "Ohio State University" },
    { name = "Shopping at Easton", xp = 10, cost = 50, district = "Easton Town Center" },
    { name = "Blue Jackets Game", xp = 30, cost = 75, district = "Arena District" },
    { name = "Dine at Schmidt's", xp = 15, cost = 30, district = "German Village" },
    { name = "North Market Food Tour", xp = 20, cost = 25, district = "Short North Arts District" },
}

VacationConfig.PASSIVE_INCOME_RATE = 0.5 -- 50% of normal business income while on vacation
VacationConfig.RENTAL_DISCOUNT = 0.8 -- 20% off rental for vacation mode

return VacationConfig
```

**Step 2: Write vacation mode logic**

```lua
-- src/server/VacationMode.luau
local EconomySystem = require(script.Parent.EconomySystem)
local VehicleSystem = require(script.Parent.VehicleSystem)
local VacationConfig = require(game.ReplicatedStorage.Shared.VacationConfig)

local VacationMode = {}
VacationMode.__index = VacationMode

local activeVacations = {}

function VacationMode.start(player: Player, vehicleId: string): boolean
    if activeVacations[player.UserId] then return false end

    -- Rent the vehicle for the player
    if not VehicleSystem.rentVehicle(vehicleId, player.UserId) then
        return false
    end

    activeVacations[player.UserId] = {
        vehicleId = vehicleId,
        startTime = tick(),
        activitiesCompleted = {},
        totalSpent = 0,
    }

    return true
end

function VacationMode.completeActivity(player: Player, activityName: string): boolean
    local vacation = activeVacations[player.UserId]
    if not vacation then return false end

    -- Find activity
    local activity
    for _, a in ipairs(VacationConfig.ACTIVITIES) do
        if a.name == activityName then
            activity = a
            break
        end
    end
    if not activity then return false end

    -- Check if already done
    if vacation.activitiesCompleted[activityName] then return false end

    -- Charge cost
    if activity.cost > 0 then
        if not EconomySystem.chargePlayer(player, activity.cost) then
            return false
        end
        vacation.totalSpent = vacation.totalSpent + activity.cost
    end

    -- Award XP
    EconomySystem.addXP(player, activity.xp)
    vacation.activitiesCompleted[activityName] = true

    return true
end

function VacationMode.endVacation(player: Player): { duration: number, activities: number, spent: number }
    local vacation = activeVacations[player.UserId]
    if not vacation then return nil end

    VehicleSystem.returnVehicle(vacation.vehicleId)

    local result = {
        duration = tick() - vacation.startTime,
        activities = 0,
        spent = vacation.totalSpent,
    }
    for _ in pairs(vacation.activitiesCompleted) do
        result.activities = result.activities + 1
    end

    activeVacations[player.UserId] = nil
    return result
end

function VacationMode.isOnVacation(player: Player): boolean
    return activeVacations[player.UserId] ~= nil
end

return VacationMode
```

**Step 3: Commit**

```bash
git add src/shared/VacationConfig.luau src/server/VacationMode.luau
git commit -m "feat: add vacation mode with city activities and passive income"
```

---

## Phase 8: Testing & Polish

### Task 18: Integration Tests

**Files:**
- Create: `src/server/tests/Integration.spec.luau`

**Step 1: Write integration tests**

```lua
-- src/server/tests/Integration.spec.luau
local DataManager = require(script.Parent.Parent.DataManager)
local EconomyConfig = require(game.ReplicatedStorage.Shared.EconomyConfig)
local Constants = require(game.ReplicatedStorage.Shared.Constants)
local VehicleConfig = require(game.ReplicatedStorage.Shared.VehicleConfig)
local Columbus = require(game.ReplicatedStorage.Shared.CityData.Columbus)

return function()
    describe("Game Constants", function()
        it("should have correct time multiplier", function()
            expect(Constants.TIME_MULTIPLIER).to.equal(7)
        end)

        it("should have 8 careers", function()
            local count = 0
            for _ in pairs(Constants.CAREERS) do count = count + 1 end
            expect(count).to.equal(8)
        end)

        it("should have 8 car classes", function()
            local count = 0
            for _ in pairs(Constants.CAR_CLASSES) do count = count + 1 end
            expect(count).to.equal(8)
        end)
    end)

    describe("Columbus City Data", function()
        it("should have correct airport code", function()
            expect(Columbus.AIRPORT_CODE).to.equal("CMH")
        end)

        it("should have 8 districts", function()
            expect(#Columbus.DISTRICTS).to.equal(8)
        end)

        it("should have 7 rental slots", function()
            expect(#Columbus.RENTAL_SLOTS).to.equal(7)
        end)

        it("should have road connections", function()
            expect(#Columbus.ROADS).to.be.gt(0)
        end)
    end)

    describe("Economy Config", function()
        it("should have pay for all 8 careers", function()
            expect(EconomyConfig.CAREER_PAY.RentalAgent).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.Mechanic).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.FranchiseOwner).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.ShuttleDriver).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.CarTransporter).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.SalesRep).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.FoodCourtWorker).to.be.ok()
            expect(EconomyConfig.CAREER_PAY.Janitor).to.be.ok()
        end)

        it("should have location costs", function()
            expect(EconomyConfig.LOCATION_COSTS.SmallLot).to.be.ok()
            expect(EconomyConfig.LOCATION_COSTS.AirportCounter.price).to.equal(100000)
        end)
    end)

    describe("Vehicle Config", function()
        it("should have vehicles for each class", function()
            local classesFound = {}
            for _, config in pairs(VehicleConfig.VEHICLES) do
                classesFound[config.class] = true
            end
            expect(classesFound.Economy).to.equal(true)
            expect(classesFound.Luxury).to.equal(true)
            expect(classesFound.Exotic).to.equal(true)
        end)

        it("should have realistic speed ranges", function()
            for name, config in pairs(VehicleConfig.VEHICLES) do
                expect(config.speed).to.be.gt(100)
                expect(config.speed).to.be.lt(300)
            end
        end)
    end)

    describe("Player Data", function()
        it("should create valid default data", function()
            local data = DataManager.getDefaultData()
            expect(DataManager.validateData(data)).to.equal(true)
        end)

        it("should start with correct money", function()
            local data = DataManager.getDefaultData()
            expect(data.money).to.equal(Constants.STARTING_MONEY)
        end)
    end)
end
```

**Step 2: Commit**

```bash
git add src/server/tests/
git commit -m "test: add integration tests for game constants, city data, and player data"
```

---

### Task 19: Loading Screen

**Files:**
- Create: `src/loading/LoadingScreen.client.luau`

**Step 1: Write loading screen**

```lua
-- src/loading/LoadingScreen.client.luau
local ContentProvider = game:GetService("ContentProvider")
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local Players = game:GetService("Players")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Remove default loading screen
ReplicatedFirst:RemoveDefaultLoadingScreen()

-- Create custom loading screen
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "LoadingScreen"
screenGui.IgnoreGuiInset = true
screenGui.Parent = playerGui

local bg = Instance.new("Frame")
bg.Size = UDim2.new(1, 0, 1, 0)
bg.BackgroundColor3 = Color3.fromRGB(15, 15, 25)
bg.BorderSizePixel = 0
bg.Parent = screenGui

local title = Instance.new("TextLabel")
title.Size = UDim2.new(0.6, 0, 0.1, 0)
title.Position = UDim2.new(0.2, 0, 0.3, 0)
title.BackgroundTransparency = 1
title.Text = "CAR RENTAL EMPIRE"
title.TextColor3 = Color3.fromRGB(255, 255, 255)
title.TextScaled = true
title.Font = Enum.Font.GothamBold
title.Parent = bg

local subtitle = Instance.new("TextLabel")
subtitle.Size = UDim2.new(0.4, 0, 0.04, 0)
subtitle.Position = UDim2.new(0.3, 0, 0.42, 0)
subtitle.BackgroundTransparency = 1
subtitle.Text = "Columbus, Ohio"
subtitle.TextColor3 = Color3.fromRGB(150, 150, 200)
subtitle.TextScaled = true
subtitle.Font = Enum.Font.Gotham
subtitle.Parent = bg

local statusLabel = Instance.new("TextLabel")
statusLabel.Size = UDim2.new(0.5, 0, 0.03, 0)
statusLabel.Position = UDim2.new(0.25, 0, 0.55, 0)
statusLabel.BackgroundTransparency = 1
statusLabel.Text = "Loading..."
statusLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
statusLabel.TextScaled = true
statusLabel.Font = Enum.Font.Gotham
statusLabel.Parent = bg

-- Progress bar
local barBg = Instance.new("Frame")
barBg.Size = UDim2.new(0.4, 0, 0.02, 0)
barBg.Position = UDim2.new(0.3, 0, 0.6, 0)
barBg.BackgroundColor3 = Color3.fromRGB(50, 50, 70)
barBg.BorderSizePixel = 0
barBg.Parent = bg

local barFill = Instance.new("Frame")
barFill.Size = UDim2.new(0, 0, 1, 0)
barFill.BackgroundColor3 = Color3.fromRGB(0, 150, 255)
barFill.BorderSizePixel = 0
barFill.Parent = barBg

-- Wait for game to load
local assets = game:GetDescendants()
local totalAssets = #assets

for i, asset in ipairs(assets) do
    if asset:IsA("Decal") or asset:IsA("Texture") or asset:IsA("Sound") then
        ContentProvider:PreloadAsync({asset})
    end
    barFill.Size = UDim2.new(i / totalAssets, 0, 1, 0)
    statusLabel.Text = string.format("Loading assets... %d%%", math.floor(i / totalAssets * 100))
end

statusLabel.Text = "Ready!"
task.wait(1)

-- Fade out
for i = 0, 1, 0.05 do
    bg.BackgroundTransparency = i
    title.TextTransparency = i
    subtitle.TextTransparency = i
    statusLabel.TextTransparency = i
    barBg.BackgroundTransparency = i
    barFill.BackgroundTransparency = i
    task.wait(0.02)
end

screenGui:Destroy()
```

**Step 2: Commit**

```bash
git add src/loading/
git commit -m "feat: add custom loading screen with progress bar"
```

---

## Future Phases (Post-MVP)

### Phase 9: Additional Cities (12 more)
Suggested cities for future expansion:
1. Los Angeles, CA (LAX)
2. Miami, FL (MIA)
3. New York, NY (JFK)
4. Chicago, IL (ORD)
5. Las Vegas, NV (LAS)
6. Dallas, TX (DFW)
7. Atlanta, GA (ATL)
8. Denver, CO (DEN)
9. San Francisco, CA (SFO)
10. Seattle, WA (SEA)
11. Orlando, FL (MCO)
12. Phoenix, AZ (PHX)

Each city follows the same structure as Columbus (Task 10) with unique districts, landmarks, and rental slots.

### Phase 10: Multiplayer Franchise System
- Player-to-player franchise agreements
- Franchise branding and customization
- Regional competition between franchises

### Phase 11: Advanced AI
- NPC memory (remembers past interactions)
- Dynamic pricing based on demand
- Weather events affecting rental demand
- Seasonal tourism patterns

### Phase 12: Cosmetics & Monetization
- Car wrap designs (Robux)
- Shop decorations (Robux)
- Employee uniforms
- Custom shuttle liveries
- 2x earnings game pass

---

## File Structure Summary

```
CarRentalEmpire/
├── default.project.json
├── .gitignore
└── src/
    ├── shared/
    │   ├── Constants.luau
    │   ├── TimeUtils.luau
    │   ├── EconomyConfig.luau
    │   ├── VehicleConfig.luau
    │   ├── AirportConfig.luau
    │   ├── VacationConfig.luau
    │   └── CityData/
    │       └── Columbus.luau
    ├── server/
    │   ├── init.server.luau
    │   ├── DataManager.luau
    │   ├── TimeSystem.luau
    │   ├── EconomySystem.luau
    │   ├── CityManager.luau
    │   ├── AirportSystem.luau
    │   ├── VehicleSystem.luau
    │   ├── RentalLocation.luau
    │   ├── VacationMode.luau
    │   ├── AI/
    │   │   ├── BehaviorTree.luau
    │   │   ├── NPCManager.luau
    │   │   └── EmployeeNPC.luau
    │   ├── Careers/
    │   │   ├── RentalAgent.luau
    │   │   ├── Mechanic.luau
    │   │   ├── FranchiseOwner.luau
    │   │   ├── ShuttleDriver.luau
    │   │   ├── CarTransporter.luau
    │   │   ├── SalesRep.luau
    │   │   ├── FoodCourtWorker.luau
    │   │   └── Janitor.luau
    │   └── tests/
    │       ├── DataManager.spec.luau
    │       └── Integration.spec.luau
    ├── client/
    │   ├── init.client.luau
    │   ├── TimeDisplay.luau
    │   └── Careers/
    │       └── RentalAgentUI.luau
    ├── ui/
    │   ├── CareerSelect.luau
    │   ├── HUD.luau
    │   └── Components/
    │       └── CareerCard.luau
    └── loading/
        └── LoadingScreen.client.luau
```
