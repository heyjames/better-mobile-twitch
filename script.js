// ==UserScript==
// @name         Better Mobile Twitch
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Originally made to disable click-to-pause video
// @author       You
// @match        https://m.twitch.tv/*
// @match        https://www.twitch.tv/popout/*/chat*
// @grant        none
// ==/UserScript==
// DONE: handle resolution change and click more message.
// DONE: Initialize from state instead so you can have defaults to set in the
//       state if you wanna start the stream with the chat off.
// DONE: Button colors are buggy when toggled. Requires redesign--lots of refactoring.
// DONE: Handle popout chat.

// TODO: DRY review: Refactor to a function to handle creating all elements like
//       buttons and its onclick handlers.
// TODO: Move user config to localstorage?
// TODO: Add try catch error handling to functions to pinpoint bugs.
// TODO: Add support for Safari browser.
// TODO: Override chat usernames to better readability so I won't need to use the
//       Stylus CSS script.

//////////////////////////////////////////////////////////////////////
// User set preferences (OK to change). //////////////////////////////
//////////////////////////////////////////////////////////////////////
const USER_CONFIG = {
    showChat: false, // boolean
    showChatInfo: false, // boolean
    autoUnmute: true, // boolean
    autoClickVideoToPause: true, // boolean
    showNavBar: false, // boolean
    unmuteAttempts: 20, // integer
    unmuteInterval: 200, // integer (milliseconds)
    removePopoutChatHeader: true, // boolean
    removePopoutChatLeaderboard: true, // boolean
    removePopoutChatPoll: true, // boolean
    removePopoutChatInput: true // boolean
};
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////

const CSS = `
.default {
background-color: rgba(145, 71, 255, 0.08);
z-index: 1;
position: absolute;
top: 10px;
right: 10px;
border-radius: 4px;
font-weight: bold;
user-select: none;
-webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
border-radius: 4px;
padding: 1px 8px;
color: rgba(255, 255, 255, 0);
}

.default:hover {
background-color: rgba(145, 71, 255, 0.5);
z-index: 1;
position: absolute;
top: 10px;
right: 10px;
border-radius: 4px;
user-select: none;
-webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
border-radius: 4px;
padding: 1px 8px;
color: inherit;
}
`;

// Internal state (Developer use only).
let IS_CHAT_SHOWING = true;
let IS_CHAT_MINIMAL = false;
let IS_NAVBAR_SHOWING = true;
let HAS_UNMUTED = false;
let UNMUTE_INTERVAL = null;

// Store temporary HTML nodes when toggling nodes (Developer use only).
let CHAT_NODE = null;
let NAVBAR_NODE = null;
let toggleChatButton = null;
let expandChatButton = null;
let toggleNavBarButton = null;

(function() {
    'use strict';

    window.onload = main;
})();

function main() {
    // Check if URL is mobile popout chat. The mobile chat doesn't support FFZ and it's BTTV addon.
    const url = window.location.href;
    const isPopoutChatRegex = /https:\/\/www\.twitch\.tv\/popout\/.*\/chat\?no-mobile-redirect=.*/g;
    const isPopoutChat = url.match(isPopoutChatRegex);
    if (isPopoutChat !== null) return handlePopoutChat();

    // If URL is mobile Twitch.
    handleMobileTwitch();

    // Execute main function again when user navigates from within the page
    // since only a portion of the page is changed when selecting links.
    observeInternalPageNavigation();
}

function handlePopoutChat() {
    // Remove chat header.
    if (USER_CONFIG.removePopoutChatHeader) {
        let popOutChatHeaderSelector = "stream-chat-header tw-align-items-center tw-border-b";
        popOutChatHeaderSelector += " tw-c-background-base tw-flex tw-flex-shrink-0 tw-full-width";
        popOutChatHeaderSelector += " tw-justify-content-center tw-pd-l-1 tw-pd-r-1";
        removeNode("div", "class", popOutChatHeaderSelector, "Popout Chat Header");
    }

    // Remove chat leaderboard.
    if (USER_CONFIG.removePopoutChatLeaderboard) {
        let popoutChatLeaderboardSelector = "channel-leaderboard tw-z-default";
        removeNode("div", "class", popoutChatLeaderboardSelector, "Popout Chat Leaderboard");
    }

    // Remove poll.
    if (USER_CONFIG.removePopoutChatPoll) {
        let popoutChatPollSelector = "tw-absolute tw-full-width tw-z-above";
        removeNode("div", "class", popoutChatPollSelector, "Popout Chat Poll");
    }

    // Remove chat input.
    if (USER_CONFIG.removePopoutChatInput) {
        let popoutChatInputSelector = "chat-input tw-block tw-pd-b-1 tw-pd-x-1";
        removeNode("div", "class", popoutChatInputSelector, "Popout Chat Input");
    }
}

function removeNode(element, attribute, selector, metaErrorLabel="") {
    const node = document.querySelector(`${element}[${attribute}="${selector}"]`);
    if (metaErrorLabel !== "") metaErrorLabel += " ";
    if (node === null) return console.error(`Remove ${metaErrorLabel}node failed.`);

    node.remove();
}

function handleMobileTwitch() {
    removeInAppButton();

    // Ignore non streamer pages which help when navigating from within the page
    // since only a portion of the page is changed when selecting links.
    if (window.location.href.split("/")[3] === "") return;
    if (window.location.href.split("/")[3] === "directory") return;
    if (window.location.href.split("/")[4] !== undefined) return;

    // Init
    clickMoreMsgBelowAfterResize();
    // Store button nodes that may be removed and restored via toggle buttons.
    storeChatInState();
    storeNavBarInState();
    toggleChatButton = createToggleChatButton();
    expandChatButton = createExpandChatButton();
    toggleNavBarButton = createToggleNavBarButton();
    // Non-storing nodes
    const outgoingChatButton = createOutgoingChatButton();

    // Insert HTML nodes.
    addToggleChatButton();
    addExpandChatButton();
    addToggleNavBarButton();
    addOutgoingChatButton(outgoingChatButton);

    // Append my CSS style node to head.
    const head = document.querySelector("head");
    let styleNode = document.createElement("style");
    styleNode.id = "my-style";
    head.prepend(styleNode);
    const myStyleNode = document.getElementById("my-style");
    myStyleNode.innerHTML = CSS;

    // Apply user config.
    if (USER_CONFIG.autoClickVideoToPause === true) disableClickVideoToPause();
    if (USER_CONFIG.autoUnmute === true) unmute();
    if (USER_CONFIG.showChat === false) handleToggleChatButton();
    if (USER_CONFIG.showChatInfo === false) handleExpandChatButton();
    if (USER_CONFIG.showNavBar === false) handleToggleNavBarButton();
}

function handleOutgoingChatButton() {
    // Get streamer's name from URL.
    const streamerName = window.location.href.split("/")[3];

    let url = `https://www.twitch.tv/popout/${streamerName}`;
    url += `/chat?no-mobile-redirect=true`;

    // Open chat in new tab.
    window.open(url);
}

function handleToggleChatButton() {
    if (IS_CHAT_SHOWING === true) {
        removeChat();
        removeExpandChatButton();
    } else {
        addChat(CHAT_NODE);
        addExpandChatButton();
    }

    moveVideo();
}

function handleToggleNavBarButton() {
    if (IS_NAVBAR_SHOWING === true) {
        removeNavBar();
    } else {
        addNavBar();
    }

    moveContent();
}

function removeNavBar() {
    if (NAVBAR_NODE === null) return console.error("Nav bar node is null.");

    NAVBAR_NODE.remove();

    IS_NAVBAR_SHOWING = false;
}

function addNavBar() {
    const navParentSelector = "tw-absolute tw-bottom-0 tw-left-0 tw-right-0 tw-top-0";
    const navParentNode = document.getElementsByClassName(navParentSelector)[0];
    if (navParentNode === null) return console.error("navParent node is null.");

    navParentNode.prepend(NAVBAR_NODE);
    IS_NAVBAR_SHOWING = true;
}

function removeChat() {
    const chatSelector = "ScSecondaryContent-sc-1swxymf-2 gbWnuH";
    const chatNode = document.getElementsByClassName(chatSelector)[0];
    if (chatNode === null) return console.error("Chat section is null.");

    chatNode.remove();
    IS_CHAT_SHOWING = false;
}

function addChat() {
    const mainContentSelector = "ScPlayerLayout-sc-1swxymf-0 kfzBMr";
    const mainContentNode = document.getElementsByClassName(mainContentSelector)[0];
    if (mainContentNode === null) return console.error("Main content node is null.");

    mainContentNode.appendChild(CHAT_NODE);
    IS_CHAT_SHOWING = true;
}

function handleExpandChatButton() {
    if (IS_CHAT_MINIMAL === true) {
        expandChat();
    } else {
        shrinkChat();
    }
}

// TODO: Rename related functions to be shrink/expand? This hides the top and bottom
// chat sections (stream info, tags, chat input).
function expandChat() {
    const chatTopInfoSelector = "div[class='tw-border-b tw-c-background-base']";
    const chatTopInfoNode = document.querySelector(chatTopInfoSelector);
    chatTopInfoNode.style.cssText = "display: block;";

    const chatInputSelector = "div[class='tw-flex-shrink-0']";
    const chatInputNode = document.querySelector(chatInputSelector);
    chatInputNode.style.cssText = "display: block;";

    IS_CHAT_MINIMAL = false;
}

// TODO: Rename related functions to be shrink/expand? This restores the top and bottom
// chat sections (stream info, tags, chat input).
function shrinkChat() {
    try {
        shrinkChat();
    } catch (error) {
        console.error("Shrink chat failed.");
    }
}

// Move video to take up the entire width when chat is removed. It also horizontally
// centers the video.
function moveVideo() {
    const videoSelector = "section[class='ScPlayerContainer-sc-1swxymf-1 iNvFnX']";
    const videoNode = document.querySelector(videoSelector);
    if (videoNode === null) return console.error("Video node is null.");

    let height = (IS_CHAT_SHOWING === true)
        ? "heightcalc(56.25vw);"
        : "height: 100% !important;";

    let width = (IS_CHAT_SHOWING === true)
        ? ""
        : "width: 100% !important;";

    const css = `background: rgb(24 24 27);
                 ${height}
                 ${width}
                 flex-shrink: 0;
                `;

    videoNode.style.cssText = css;
}

// Move entire content up after removing top navigation bar.
function moveContent() {
    const contentNode = document.getElementsByClassName("fSQzTO")[0];
    if (contentNode === null) return console.error("Content node is null.");

    if (IS_NAVBAR_SHOWING === true) {
        contentNode.style.marginTop = "50px"
        contentNode.style.height = "calc(100% - 50px)";
    } else {
        contentNode.style.marginTop = "0px";
        contentNode.style.height = "100%";
    }
}














































function createToggleChatButton() {
    let btn = document.createElement("button");
    btn.type = "button";
    btn.id = "toggle-chat";
    btn.innerHTML = "Chat";
    btn.title = "Toggle Chat";
    const css = `border-radius: 4px;
                 padding: 6px 12px;
                 margin-left: 6px;
                 font-weight: bold;
                 user-select: none;
                 background-color: #4a4a4a;
                 -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                `;
    btn.style.cssText = css;
    btn.onclick = handleToggleChatButton;

    return btn;
}

function createToggleNavBarButton() {
    let btn = document.createElement("button");
    btn.type = "button";
    btn.id = "toggle-nav-bar";
    btn.className = "default";
    btn.innerHTML = "^";
    /*const css = `border-radius: 4px;
                 padding: 6px 12px;
                 font-weight: bold;
                 user-select: none;
                 background-color: #4a4a4a;
                 -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                `;*/
    //btn.style.cssText = css;
    btn.onclick = handleToggleNavBarButton;

    return btn;
}

function createExpandChatButton() {
    const btn = document.createElement("button");
    btn.id = "expand-chat";
    btn.type = "button";
    btn.innerHTML = "Info";
    btn.title = "Toggle chat input and chat top stream info";
    const css = `margin-left: 6px;
                 /*background-color: #9147ff;*/
                 border-radius: 4px;
                 padding: 6px 12px;
                 font-weight: bold;
                 user-select: none;
                 -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                `;
    btn.style.cssText = css;
    btn.onclick = handleExpandChatButton;

    return btn;
}

function createOutgoingChatButton() {
    let btn = document.createElement("button");
    btn.type = "button";
    btn.id = "outgoing-chat";
    btn.innerHTML = "+";
    btn.title = "Open chat in new tab";
    const css = `border-radius: 4px;
                 padding: 6px 12px;
                 font-weight: bold;
                 user-select: none;
                 background-color: #4a4a4a;
                 -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                `;
    btn.style.cssText = css;
    btn.onclick = handleOutgoingChatButton;

    return btn;
}

















































function addOutgoingChatButton(outgoingChatButton) {
    const navButtonSelector = "tw-inline-flex tw-mg-r-1";
    const navButtonWrapperNode = document.getElementsByClassName(navButtonSelector)[0];
    if (navButtonWrapperNode === null) return console.error("navButtonWrapper node is null.");

    navButtonWrapperNode.prepend(outgoingChatButton);
}

function addToggleNavBarButton() {
    const videoWrapperSelector = "pulsar-mp-container";
    const videoWrapperNode = document.getElementsByClassName(videoWrapperSelector)[0];
    if (videoWrapperNode === null) return console.error("videoWrapperNode node is null.");

    videoWrapperNode.appendChild(toggleNavBarButton);
}

function addToggleChatButton() {
    const navButtonSelector = "tw-inline-flex tw-mg-r-1";
    const navButtonWrapperNode = document.getElementsByClassName(navButtonSelector)[0];
    if (navButtonWrapperNode === null) return console.error("navButtonWrapper node is null.");

    navButtonWrapperNode.appendChild(toggleChatButton);
}

function addExpandChatButton() {
    const navButtonSelector = "tw-inline-flex tw-mg-r-1";
    const navButtonWrapperNode = document.getElementsByClassName(navButtonSelector)[0];
    if (navButtonWrapperNode === null) return console.error("navButtonWrapper node is null.");

    navButtonWrapperNode.appendChild(expandChatButton);
}

function removeExpandChatButton() {
    const expandChatButtonSelector = "expand-chat";
    const expandChatButtonNode = document.getElementById(expandChatButtonSelector);
    if (expandChatButtonNode === null) return console.error("expandChatButtonNode is null.");

    expandChatButtonNode.remove();
}

function removeInAppButton() {
    try {
        const openInAppSelector = "open-in-app";
        const openInAppButtonNode = document.getElementsByClassName(openInAppSelector)[0];
        if (openInAppButtonNode === null) return console.error("'Open in App' button node is null.");

        openInAppButtonNode.remove();
    } catch (error) {
        console.error("error", error);
    }
}

// Observe when user navigates away after loading page, and initialize script.
function observeInternalPageNavigation() {
    var target = document.querySelector('title');
    var observer = new MutationObserver(mutations => {
        handleMobileTwitch();
    });

    var config = { subtree: false, characterData: false, childList: true };
    observer.observe(target, config);
}

function disableClickVideoToPause() {
    const nodeSelector = "div[class=\"pulsar-mp-container\"]";
    const node = document.querySelector(nodeSelector);
    if (node === null) return console.error("Click to pause node is null.");

    node.onclick = () => false;
}

function clickMoreMsgBelowAfterResize() {
    window.addEventListener('resize', () => {
        const moreMsgBelowSelector = "button[class='tw-interactive tw-align-items-center tw-align-middle tw-border-bottom-left-radius-medium tw-border-bottom-right-radius-medium tw-border-top-left-radius-medium tw-border-top-right-radius-medium tw-core-button tw-core-button--overlay tw-core-button--text tw-full-width tw-inline-flex tw-justify-content-center tw-overflow-hidden tw-relative']";
        const moreMsgBelowNode = document.querySelector(moreMsgBelowSelector);
        if (moreMsgBelowNode !== null) {
            moreMsgBelowNode.click();
        }
    });
}

async function unmute() {
    for (let i=0; i<USER_CONFIG.unmuteAttempts; i++) {
        const tapToMuteNode = getUnmuteNode();
        await pause(USER_CONFIG.unmuteInterval);

        if (tapToMuteNode !== null) {
            tapToMuteNode.click();
            HAS_UNMUTED = true;
            console.log(`Successfully unmuted after ${i} tries.`);
            break;
        }

        if (i === (USER_CONFIG.unmuteAttempts-1)) return console.error(`Failed to unmute after ${i} tries.`);
    }
}

function getUnmuteNode() {
    const tapToMuteSelector = "p[class='tw-c-text-overlay']";
    const tapToMuteNode = document.querySelector(tapToMuteSelector);
    if (tapToMuteNode === null) return null;

    return tapToMuteNode;
}

function storeChatInState() {
    const chatSelector = "ScSecondaryContent-sc-1swxymf-2 gbWnuH";
    const chatNode = document.getElementsByClassName(chatSelector)[0];
    if (chatNode === null) return console.error("Chat node is null.");

    CHAT_NODE = chatNode;
}

function storeNavBarInState() {
    const navBarSelector = "nav[class='mw-top-nav tw-absolute tw-align-items-center tw-c-background-base tw-elevation-2 tw-flex tw-full-width tw-left-0 tw-right-0 tw-top-0 tw-z-above']";
    const navBarNode = document.querySelector(navBarSelector);
    if (navBarNode === null) return console.error("Nav bar node is null.");

    NAVBAR_NODE = navBarNode;
}

function pause(ms) {
    return new Promise(resolve => {
        setTimeout(() => { resolve() }, ms);
    });
}
