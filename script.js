(function() {
    'use strict';

    console.log("%c[Nerdblud Auto Orbs] Safe Mode Starting...", "color: #5865F2; font-size: 14px; font-weight: bold;");

    const elementsToRemove = ["discord-quest-ui-root", "discord-quest-ui-styles", "discord-quest-mini-widget"];
    elementsToRemove.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
    if (window.dquLiveInterval) {
        clearInterval(window.dquLiveInterval);
        window.dquLiveInterval = null;
    }

    function waitForWebpack(callback) {
        let attempts = 0;
        const check = () => {
            if (attempts >= 100) return console.error("[Nerdblud] Webpack timeout.");
            if (typeof window.webpackChunkdiscord_app === 'undefined') {
                attempts++; setTimeout(check, 100); return;
            }
            try {
                const originalJQuery = window.$;
                delete window.$;
                const webpackRequire = window.webpackChunkdiscord_app.push([[Symbol()], {}, (require) => require]);
                window.webpackChunkdiscord_app.pop();
                if (originalJQuery) window.$ = originalJQuery;

                if (!webpackRequire || !webpackRequire.c) {
                    attempts++; setTimeout(check, 100); return;
                }
                callback(webpackRequire);
            } catch (error) {
                attempts++; setTimeout(check, 100);
            }
        };
        check();
    }

    function findModule(webpackRequire, filter) {
        if (!webpackRequire || !webpackRequire.c) return null;
        for (const module of Object.values(webpackRequire.c)) {
            if (module?.exports) {
                const exports = module.exports;
                if (exports.A && filter(exports.A)) return exports.A;
                if (exports.Ay && filter(exports.Ay)) return exports.Ay;
                if (exports.ZP && filter(exports.ZP)) return exports.ZP;
                if (filter(exports)) return exports;
            }
        }
        return null;
    }

    function loadStores(webpackRequire) {
        try {
            const QuestsStore = findModule(webpackRequire, m => m.__proto__?.getQuest);
            const ChannelStore = findModule(webpackRequire, m => m.__proto__?.getAllThreadsForParent);
            const GuildChannelStore = findModule(webpackRequire, m => m.getSFWDefaultChannel);
            const api = findModule(webpackRequire, m => m.Bo?.get || m.tn?.get);
            if (!QuestsStore || !api) return null;
            return { QuestsStore, ChannelStore, GuildChannelStore, api: api.Bo || api.tn || api };
        } catch (error) { return null; }
    }

    const supportedTasks = [
        "WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "WATCH_VIDEO_ON_DESKTOP",
        "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "STREAM_ON_MOBILE", "PLAY_ACTIVITY"
    ];

    function getActiveQuests(QuestsStore) {
        if (!QuestsStore || !QuestsStore.quests) return [];
        return [...QuestsStore.quests.values()].filter(quest => {
            const isExpired = new Date(quest.config.expiresAt).getTime() <= Date.now();
            const isCompleted = !!quest.userStatus?.completedAt;
            const isEnrolled = !!quest.userStatus?.enrolledAt;
            const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
            if (!taskConfig || !taskConfig.tasks) return false;
            const hasSupportedTask = supportedTasks.some(type => taskConfig.tasks[type] != null);
            return isEnrolled && !isCompleted && !isExpired && hasSupportedTask;
        });
    }

    function initializeQuestState(quest) {
        const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
        const taskType = supportedTasks.find(type => taskConfig.tasks[type] != null);
        const taskData = taskConfig.tasks[taskType];
        const secondsNeeded = taskData?.target ?? 0;
        const currentProgress = quest.userStatus?.progress?.[taskType]?.value ?? quest.userStatus?.streamProgressSeconds ?? 0;

        return {
            quest, taskType: taskType || "QUEST", secondsNeeded, currentProgress,
            completed: currentProgress >= secondsNeeded,
            questName: quest.config.messages?.questName ?? quest.config.application?.name ?? "Discord Quest"
        };
    }

    let userSettings = { executionMode: "sequential", autoClaimOrbs: true };
    let isRunning = false;
    let currentStores = null;
    let currentQuestStates = [];

    const randomDelay = (min, max) => new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1) + min)));

    function injectUI() {
        const style = document.createElement('style');
        style.id = "discord-quest-ui-styles";
        style.innerHTML = `
            @import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600;700;800&display=swap');

            :root {
                --brand-experiment: #5865F2;
                --brand-experiment-hover: #4752C4;
                --background-primary: #313338;
                --background-secondary: #2B2D31;
                --background-secondary-alt: #1E1F22;
                --background-modifier-hover: rgba(255,255,255,0.02);
                --text-normal: #DBDEE1;
                --text-muted: #949BA4;
                --header-primary: #F2F3F5;
                --green-color: #23A559;
                --red-color: #DA373C;
                --red-hover: #A12828;
                --scrollbar-thin-thumb: #1A1B1E;
                --scrollbar-thin-track: transparent;
            }

            #discord-quest-ui-root {
                position: fixed; bottom: 24px; right: 24px; width: 440px;
                background-color: var(--background-primary);
                border-radius: 8px; border: 1px solid var(--background-secondary-alt);
                box-shadow: 0 8px 16px rgba(0,0,0,0.24);
                color: var(--text-normal); font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                z-index: 999999; display: flex; flex-direction: column; overflow: hidden;
                animation: dquSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }

            @keyframes dquSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

            #discord-quest-mini-widget {
                position: fixed; bottom: 24px; right: 24px; z-index: 999998;
                background-color: var(--background-secondary);
                border: 1px solid var(--background-secondary-alt); border-radius: 8px;
                padding: 12px 16px; color: var(--header-primary);
                font-family: 'gg sans', sans-serif; font-size: 14px; font-weight: 600; 
                cursor: pointer; display: none; align-items: center; gap: 8px; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: background-color 0.15s;
            }
            #discord-quest-mini-widget:hover { background-color: var(--background-secondary-alt); }

            .dqu-header {
                background-color: var(--background-secondary); padding: 16px;
                display: flex; align-items: center; justify-content: space-between;
                border-bottom: 1px solid var(--background-secondary-alt);
            }

            .dqu-title-box { display: flex; align-items: center; gap: 8px; }
            .dqu-status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--green-color); }
            .dqu-status-dot.stopped { background: var(--text-muted); }
            .dqu-title { font-weight: 700; font-size: 16px; color: var(--header-primary); }

            .dqu-close-btn {
                background: transparent; border: none; color: var(--text-muted); 
                font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: color 0.2s;
            }
            .dqu-close-btn:hover { color: var(--header-primary); }

            .dqu-settings-box { background-color: var(--background-primary); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
            .dqu-setting-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
            .dqu-setting-label { font-weight: 500; color: var(--text-normal); }

            .dqu-summary-bar {
                background-color: var(--background-secondary); border-radius: 4px; padding: 10px 12px; 
                display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--text-normal);
            }

            .dqu-select-btn-group { display: flex; background: var(--background-secondary-alt); border-radius: 4px; padding: 2px; }
            .dqu-opt-btn {
                background: transparent; border: none; color: var(--text-muted); 
                padding: 6px 12px; border-radius: 4px; font-weight: 500; font-size: 13px; cursor: pointer; transition: all 0.15s ease;
            }
            .dqu-opt-btn.active { background: var(--background-secondary); color: var(--header-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .dqu-opt-btn.danger.active { background: var(--red-color); color: white; }

            .dqu-risk-warning {
                background-color: rgba(218, 55, 60, 0.1); border-left: 4px solid var(--red-color);
                color: var(--text-normal); padding: 8px 12px; border-radius: 4px; font-size: 12px; font-weight: 500; display: none; margin-top: 4px;
            }

            .dqu-body { padding: 0 16px 16px 16px; display: flex; flex-direction: column; gap: 16px; }

            #dqu-quests-container {
                max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;
            }
            #dqu-quests-container::-webkit-scrollbar { width: 8px; }
            #dqu-quests-container::-webkit-scrollbar-track { background: var(--scrollbar-thin-track); }
            #dqu-quests-container::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb); border-radius: 4px; }

            .dqu-quest-card {
                background-color: var(--background-secondary); border-radius: 8px; padding: 12px; 
                border: 1px solid transparent; transition: border-color 0.2s;
            }
            .dqu-quest-card.active { border-color: var(--brand-experiment); }
            .dqu-quest-card.completed { border-color: var(--green-color); opacity: 0.8; }

            .dqu-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .dqu-quest-title { font-weight: 600; font-size: 14px; color: var(--header-primary); }

            .dqu-status-badge { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
            .badge-pending { background: var(--background-secondary-alt); color: var(--text-muted); }
            .badge-active { background: var(--brand-experiment); color: white; }
            .badge-completed { background: var(--green-color); color: white; }

            .dqu-progress-bg { height: 8px; background: var(--background-secondary-alt); border-radius: 4px; overflow: hidden; margin: 8px 0; }
            .dqu-progress-bar { height: 100%; width: 0%; background: var(--brand-experiment); border-radius: 4px; transition: width 0.3s ease; }
            .dqu-quest-card.completed .dqu-progress-bar { background: var(--green-color); }

            .dqu-progress-info { font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between; font-weight: 500; }

            .dqu-terminal {
                background-color: var(--background-secondary-alt); border-radius: 4px; padding: 8px 12px;
                font-family: 'Consolas', monospace; font-size: 12px; height: 80px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
            }
            .dqu-terminal::-webkit-scrollbar { width: 6px; }
            .dqu-terminal::-webkit-scrollbar-thumb { background: var(--scrollbar-thin-thumb); border-radius: 3px; }
            .dqu-log-line { word-break: break-all; line-height: 1.3; }
            .dqu-log-info { color: var(--text-normal); } .dqu-log-success { color: var(--green-color); }
            .dqu-log-warn { color: #FEE75C; } .dqu-log-err { color: var(--red-color); }

            .dqu-actions { display: flex; gap: 8px; }
            .dqu-btn { flex: 1; padding: 10px 16px; border-radius: 4px; border: none; font-family: 'gg sans', sans-serif; font-weight: 500; font-size: 14px; cursor: pointer; transition: background-color 0.17s ease; color: white; }
            .dqu-btn-primary { background-color: var(--brand-experiment); }
            .dqu-btn-primary:hover { background-color: var(--brand-experiment-hover); }
            .dqu-btn-primary.disabled { background-color: var(--background-secondary-alt); color: var(--text-muted); cursor: not-allowed; }
            .dqu-btn-stop { background-color: var(--red-color); }
            .dqu-btn-stop:hover { background-color: var(--red-hover); }
            
            .dqu-footer-credits { text-align: center; font-size: 12px; color: var(--text-muted); margin-top: -8px;}
        `;
        document.head.appendChild(style);

        const miniWidget = document.createElement('div');
        miniWidget.id = "discord-quest-mini-widget";
        miniWidget.innerHTML = `🛡️ Nerdblud (Open)`;
        document.body.appendChild(miniWidget);

        const uiContainer = document.createElement('div');
        uiContainer.id = "discord-quest-ui-root";
        uiContainer.innerHTML = `
            <div class="dqu-header">
                <div class="dqu-title-box">
                    <div class="dqu-status-dot stopped" id="dqu-dot"></div>
                    <div class="dqu-title">Nerdblud | Auto Orbs</div>
                </div>
                <button class="dqu-close-btn" id="dqu-close-x" title="Minimize">✕</button>
            </div>
            <div class="dqu-settings-box">
                <div class="dqu-summary-bar">
                    <span id="dqu-total-time">⏱️ Estimated Time: -</span>
                    <span id="dqu-total-count">📊 Quests: 0</span>
                </div>
                <div class="dqu-setting-row">
                    <div class="dqu-setting-label">Claim Rewards</div>
                    <div class="dqu-select-btn-group">
                        <button class="dqu-opt-btn active" id="opt-orb-on">On</button>
                        <button class="dqu-opt-btn" id="opt-orb-off">Off</button>
                    </div>
                </div>
                <div class="dqu-setting-row">
                    <div class="dqu-setting-label">Execution Mode (Anti-Ban)</div>
                    <div class="dqu-select-btn-group">
                        <button class="dqu-opt-btn active" id="opt-mode-seq">Safe</button>
                        <button class="dqu-opt-btn danger" id="opt-mode-para">Risky (Fast)</button>
                    </div>
                </div>
                <div class="dqu-risk-warning" id="dqu-risk-banner">
                    ⚠️ WARNING: Doing tasks simultaneously increases ban risk. Safe mode (sequential) is recommended.
                </div>
            </div>
            <div class="dqu-body">
                <div id="dqu-quests-container">
                    <div style="text-align:center; padding: 20px; color: var(--text-muted); font-size:13px;">Scanning for quests...</div>
                </div>
                <div class="dqu-terminal" id="dqu-terminal">
                    <div class="dqu-log-line dqu-log-info">[System] UI ready. Modules connected.</div>
                </div>
                <div class="dqu-actions">
                    <button class="dqu-btn dqu-btn-primary" id="dqu-start-btn">Start Quests</button>
                </div>
                <div class="dqu-footer-credits">Made for Nerdblud.</div>
            </div>
        `;
        document.body.appendChild(uiContainer);

        document.getElementById("dqu-close-x").onclick = () => { uiContainer.style.display = "none"; miniWidget.style.display = "flex"; };
        miniWidget.onclick = () => { uiContainer.style.display = "flex"; miniWidget.style.display = "none"; };

        const setupOptionBtn = (btnId, groupIds, onClick) => {
            const btn = document.getElementById(btnId);
            btn.onclick = () => {
                groupIds.forEach(id => document.getElementById(id).classList.remove("active"));
                btn.classList.add("active");
                onClick();
            };
        };

        setupOptionBtn("opt-orb-on", ["opt-orb-on", "opt-orb-off"], () => { userSettings.autoClaimOrbs = true; log("Auto Claim: On", "info"); });
        setupOptionBtn("opt-orb-off", ["opt-orb-on", "opt-orb-off"], () => { userSettings.autoClaimOrbs = false; log("Auto Claim: Off", "info"); });

        const riskBanner = document.getElementById("dqu-risk-banner");
        setupOptionBtn("opt-mode-seq", ["opt-mode-seq", "opt-mode-para"], () => {
            userSettings.executionMode = "sequential"; riskBanner.style.display = "none"; log("Mode: Safe (Sequential, Human-like Delay)", "success");
        });
        setupOptionBtn("opt-mode-para", ["opt-mode-seq", "opt-mode-para"], () => {
            userSettings.executionMode = "parallel"; riskBanner.style.display = "block"; log("Mode: Risky Selected (Not Recommended!)", "err");
        });
    }

    const log = (msg, type = "info") => {
        const terminal = document.getElementById("dqu-terminal");
        if (!terminal) return;
        const line = document.createElement("div");
        line.className = `dqu-log-line dqu-log-${type}`;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        line.innerText = `[${time}] ${msg}`;
        terminal.appendChild(line);
        terminal.scrollTop = terminal.scrollHeight;
    };

    const calculateTotalTime = (questStates) => {
        let totalSeconds = 0; let uncompletedCount = 0;
        questStates.forEach(state => {
            if (!state.completed) {
                totalSeconds += Math.max(0, state.secondsNeeded - state.currentProgress);
                uncompletedCount++;
            }
        });

        const timeElem = document.getElementById("dqu-total-time");
        const countElem = document.getElementById("dqu-total-count");

        if (countElem) countElem.innerText = `📊 Quests: ${uncompletedCount} active`;
        if (timeElem) {
            if (totalSeconds <= 0) timeElem.innerText = "⏱️ Time: Completed";
            else timeElem.innerText = `⏱️ Estimated Time: ${Math.floor(totalSeconds / 60)}m ${Math.floor(totalSeconds % 60)}s`;
        }
    };

    const updateCardProgress = (questId, currentSec, totalSec, isCompleted = false) => {
        const card = document.getElementById(`dqu-card-${questId}`);
        const bar = document.getElementById(`dqu-bar-${questId}`);
        const text = document.getElementById(`dqu-text-${questId}`);
        const badge = document.getElementById(`dqu-badge-${questId}`);
        const pct = Math.min(100, Math.floor((currentSec / totalSec) * 100));

        if (bar) bar.style.width = `${pct}%`;
        if (text) text.innerText = `${Math.floor(currentSec)}s / ${totalSec}s (${pct}%)`;

        if (card) {
            if (isCompleted) {
                card.className = "dqu-quest-card completed";
                if (badge) { badge.className = "dqu-status-badge badge-completed"; badge.innerText = "Completed"; }
            } else {
                card.className = "dqu-quest-card active";
                if (badge) { badge.className = "dqu-status-badge badge-active"; badge.innerText = "Processing"; }
            }
        }
    };

    const renderQuests = () => {
        const container = document.getElementById("dqu-quests-container");
        if (!container || !currentStores) return;
        const activeQuests = getActiveQuests(currentStores.QuestsStore);
        
        if (activeQuests.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--green-color); font-weight:600;">No active quests available right now!</div>`;
            log("No doable quests found on the account.", "success");
            return;
        }
        
        container.innerHTML = "";
        currentQuestStates = activeQuests.map(quest => initializeQuestState(quest));
        calculateTotalTime(currentQuestStates);

        currentQuestStates.forEach(state => {
            const pct = Math.min(100, Math.floor((state.currentProgress / state.secondsNeeded) * 100));
            const card = document.createElement("div");
            card.className = "dqu-quest-card";
            card.id = `dqu-card-${state.quest.id}`;
            card.innerHTML = `
                <div class="dqu-card-header">
                    <div class="dqu-quest-title">${state.questName}</div>
                    <div class="dqu-status-badge badge-pending" id="dqu-badge-${state.quest.id}">${state.completed ? 'Completed' : 'Pending'}</div>
                </div>
                <div class="dqu-progress-bg">
                    <div class="dqu-progress-bar" id="dqu-bar-${state.quest.id}" style="width: ${pct}%"></div>
                </div>
                <div class="dqu-progress-info">
                    <span>Type: ${state.taskType}</span>
                    <span id="dqu-text-${state.quest.id}">${Math.floor(state.currentProgress)}s / ${state.secondsNeeded}s (${pct}%)</span>
                </div>
            `;
            container.appendChild(card);
        });
        log(`${activeQuests.length} quests detected.`, "info");
    };

    function startLiveTicker() {
        if (window.dquLiveInterval) clearInterval(window.dquLiveInterval);
        window.dquLiveInterval = setInterval(() => {
            if (!isRunning || !currentQuestStates.length) return;
            currentQuestStates.forEach(state => {
                if (!state.completed && state.currentProgress < state.secondsNeeded) {
                    state.currentProgress = Math.min(state.secondsNeeded, state.currentProgress + 1);
                    updateCardProgress(state.quest.id, state.currentProgress, state.secondsNeeded, false);
                }
            });
            calculateTotalTime(currentQuestStates);
        }, 1000);
    }

    async function processVideoStep(state, api) {
        const { quest, secondsNeeded } = state;
        const jitter = Math.random() * 1.5; 
        const nextTime = Math.min(secondsNeeded, state.currentProgress + 2 + jitter);

        try {
            const res = await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: nextTime } });
            state.currentProgress = nextTime;
            updateCardProgress(quest.id, state.currentProgress, secondsNeeded, false);

            if (res.body.completed_at !== null || state.currentProgress >= secondsNeeded) {
                state.completed = true;
                updateCardProgress(quest.id, secondsNeeded, secondsNeeded, true);
                await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
                log(`✨ ${state.questName} Completed!`, "success");
                if (userSettings.autoClaimOrbs) await claimQuestOrbs(quest, api);
            }
        } catch (error) {}
    }

    async function processHeartbeatStep(state, stores) {
        const { api, ChannelStore, GuildChannelStore } = stores;
        const { quest, taskType, secondsNeeded } = state;

        let channelId = ChannelStore?.getSortedPrivateChannels()[0]?.id;
        if (!channelId && GuildChannelStore) {
            const guilds = Object.values(GuildChannelStore.getAllGuilds());
            const voice = guilds.find(g => g?.VOCAL?.length > 0);
            if (voice) channelId = voice.VOCAL[0].channel.id;
        }
        const streamKey = channelId ? `call:${channelId}:1` : `call:${quest.id}:1`;

        try {
            const response = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
            state.currentProgress = response.body?.progress?.[taskType]?.value ?? state.currentProgress;
            updateCardProgress(quest.id, state.currentProgress, secondsNeeded, state.currentProgress >= secondsNeeded);

            if (state.currentProgress >= secondsNeeded) {
                await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
                state.completed = true;
                updateCardProgress(quest.id, secondsNeeded, secondsNeeded, true);
                log(`✨ ${state.questName} Completed!`, "success");
                if (userSettings.autoClaimOrbs) await claimQuestOrbs(quest, api);
            }
        } catch (error) {}
    }

    async function claimQuestOrbs(quest, api) {
        log(`Claiming reward: ${quest.config.messages?.questName || 'Quest'}`, "info");
        try {
            const res = await api.post({ url: `/quests/${quest.id}/claim`, body: { platform: 0 } });
            if (res.body) log(`🎉 Reward Successfully Claimed!`, "success");
        } catch(e) {}
    }

    async function runQuestEngine(stores) {
        const activeQuests = getActiveQuests(stores.QuestsStore);
        if (activeQuests.length === 0) {
            log("No quests to complete found.", "success");
            const startBtn = document.getElementById("dqu-start-btn");
            if (startBtn) { startBtn.innerText = "No Quests"; startBtn.className = "dqu-btn dqu-btn-primary disabled"; }
            document.getElementById("dqu-dot").classList.add("stopped");
            isRunning = false; return;
        }

        currentQuestStates = activeQuests.map(quest => initializeQuestState(quest));
        startLiveTicker();

        const runStateLoop = async (state) => {
            while (!state.completed && isRunning) {
                const isVideo = state.taskType.includes("VIDEO") || state.taskType.includes("WATCH");
                if (isVideo) {
                    await processVideoStep(state, stores.api);
                    if (!state.completed && isRunning) await randomDelay(2000, 4000); 
                } else {
                    await processHeartbeatStep(state, stores);
                    if (!state.completed && isRunning) await randomDelay(15000, 22000);
                }
            }
        };

        if (userSettings.executionMode === "parallel") {
            log(`Parallel Mode: Quests are being done simultaneously.`, "warn");
            await Promise.all(currentQuestStates.map(state => runStateLoop(state)));
        } else {
            for (const state of currentQuestStates) {
                if (!isRunning) break;
                if (!state.completed) await runStateLoop(state);
                if (isRunning && !state.completed) await randomDelay(3000, 7000); 
            }
        }

        if (isRunning) {
            log("All quests completed successfully!", "success");
            const startBtn = document.getElementById("dqu-start-btn");
            if (startBtn) { startBtn.innerText = "Completed"; startBtn.className = "dqu-btn dqu-btn-primary disabled"; }
            document.getElementById("dqu-dot").classList.add("stopped");
            isRunning = false;
        }
    }

    waitForWebpack((webpackRequire) => {
        const stores = loadStores(webpackRequire);
        if (!stores) { alert("Discord modules not found. Please refresh the page."); return; }

        currentStores = stores;
        injectUI();
        renderQuests();

        const startBtn = document.getElementById("dqu-start-btn");
        const statusDot = document.getElementById("dqu-dot");

        startBtn.onclick = () => {
            if (startBtn.classList.contains("disabled")) return;
            if (isRunning) {
                isRunning = false;
                if (window.dquLiveInterval) { clearInterval(window.dquLiveInterval); window.dquLiveInterval = null; }
                startBtn.innerText = "Start Quests";
                startBtn.className = "dqu-btn dqu-btn-primary";
                statusDot.classList.add("stopped");
                log("Process stopped.", "warn");
            } else {
                isRunning = true;
                startBtn.innerText = "Stop Process";
                startBtn.className = "dqu-btn dqu-btn-stop";
                statusDot.classList.remove("stopped");
                log("Process started.", "info");
                runQuestEngine(stores);
            }
        };
    });
})();
