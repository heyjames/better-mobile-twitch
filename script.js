// ==UserScript==
// @name         Better Mobile Twitch
// @namespace    http://tampermonkey.net/
// @version      0.3.1
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
// DONE: Handle popout chat
// DONE: 2021-02-28: Add a transparent button for chat on player corner.

// TODO: DRY review: Refactor to a function to handle creating all elements like
//       buttons and its onclick handlers.
// TODO: Move user config to localstorage?
// TODO: Add try catch error handling to functions to pinpoint bugs.
// TODO: Add support for Safari browser.
// TODO: Override chat usernames to better readability so I won't need to use the
//       Stylus CSS script.

// Install Google's user agent switcher extension and use iPhone 6
// https://chrome.google.com/webstore/detail/user-agent-switcher-for-c/djflhoibgkdhkhhcedjiklpkjnoahfmg

// Best if used with Google Chrome shortcut target options.
// On Windows, find the Google Chrome shortcut.
// Right-click it and select Properties.
// Make sure the two options (the double dash part) is added.
// "...\Application\chrome.exe" --auto-open-devtools-for-tabs --autoplay-policy=no-user-gesture-required

//////////////////////////////////////////////////////////////////////
// User set preferences (OK to change values). ///////////////////////
//////////////////////////////////////////////////////////////////////
const USER_CONFIG = {
    showChat: true, // boolean
    showChatInfo: false, // boolean
    autoUnmute: true, // boolean
    autoClickVideoToPause: true, // boolean
    showNavBar: false, // boolean
    unmuteAttempts: 30, // integer
    unmuteInterval: 400, // integer (milliseconds)
    removePopoutChatHeader: true, // boolean
    removePopoutChatLeaderboard: true, // boolean
    removePopoutChatPoll: true, // boolean
    removePopoutChatInput: true // boolean
};
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////

const CSS = `
.overlay-button {
right: 10px;
background-color: rgba(145, 71, 255, 0.2);
z-index: 1;
position: absolute;
border-radius: 4px;
font-weight: bold;
user-select: none;
-webkit-tap-highlight-color: rgba(255, 255, 255, 0);
border-radius: 4px;
padding: 1px 8px;
color: rgba(255, 255, 255, 0.2);
}

.overlay-button:hover {
right: 10px;
background-color: rgba(145, 71, 255, 0.5);
z-index: 2;
position: absolute;
border-radius: 4px;
font-weight: bold;
user-select: none;
-webkit-tap-highlight-color: rgba(255, 255, 255, 0);
border-radius: 4px;
padding: 1px 8px;
color: rgba(255, 255, 255, 1);
}

.navbar {
top: 10px;
}

.chat {
top: 40px;
}
`;

// Internal state (Developer use only).
let IS_CHAT_SHOWING = true;
let IS_CHAT_MINIMAL = true;
let IS_NAVBAR_SHOWING = true;
let HAS_UNMUTED = false;
let UNMUTE_INTERVAL = null;

// Store temporary HTML nodes when toggling nodes (Developer use only).
let CHAT_NODE = null;
let NAVBAR_NODE = null;
let toggleChatButton = null;
let expandChatButton = null;
let toggleNavBarButton = null;
let toggleChatButtonSm = null;

(function() {
    'use strict';

    window.onload = main;
})();

function main() {
    // Check if URL is mobile popout chat. The mobile chat doesn't support FFZ and its BTTV addon.
    const url = window.location.href;
    const isPopoutChatRegex = /https:\/\/www\.twitch\.tv\/popout\/.*\/chat\?no-mobile-redirect=.*/g;
    const isPopoutChat = url.match(isPopoutChatRegex);
    if (isPopoutChat !== null) return Chat.handlePopoutChat();

    // If URL is mobile Twitch.
    handleMobileTwitch();

    // Execute main function again when user navigates from within the page
    // since only a portion of the page is changed when selecting links.
    observeInternalPageNavigation();
}

function handleMobileTwitch() {
    Navbar.removeInAppButton();

    // Ignore non streamer pages which help when navigating from within the page
    // since only a portion of the page is changed when selecting links.
    if (window.location.href.split("/")[3] === "") return;
    if (window.location.href.split("/")[3] === "directory") return;
    if (window.location.href.split("/")[4] !== undefined) return;

    // Init
    Chat.clickMoreMsgBelowAfterResize();
    // Store button nodes that may be removed and restored via toggle buttons.
    Chat.storeChatInState();
    Navbar.storeInState();
    toggleChatButton = Button.createToggleChat();
    expandChatButton = Button.createExpandChat();
    toggleNavBarButton = Button.createToggleNavBar();
    toggleChatButtonSm = Button.createToggleChatSm();
    // Non-storing nodes
    const outgoingChatButton = Button.createOutgoingChat();

    // Insert HTML nodes.
    Utils.attachNode("append", Utils.getNodeByClassName("tw-inline-flex tw-mg-r-1"), toggleChatButton);
    Utils.attachNode("append", Utils.getNodeByClassName("tw-inline-flex tw-mg-r-1"), expandChatButton);
    Utils.attachNode("append", Utils.getNodeByClassName("pulsar-mp-container"), toggleNavBarButton);
    Utils.attachNode("append", Utils.getNodeByClassName("pulsar-mp-container"), toggleChatButtonSm);
    Utils.attachNode("prepend", Utils.getNodeByClassName("tw-inline-flex tw-mg-r-1"), outgoingChatButton);

    // Append my CSS style node to head.
    const head = document.querySelector("head");
    const styleNode = document.createElement("style");
    head.prepend(styleNode);
    styleNode.innerHTML = CSS;

    // Apply user config.
    if (USER_CONFIG.autoClickVideoToPause === true) Player.disableClickToPause();
    if (USER_CONFIG.autoUnmute === true) Player.unmute();
    if (USER_CONFIG.showChat === false) Button.handleToggleChat();
    if (USER_CONFIG.showChatInfo === false) Chat.handleExpandChatButton();
    if (USER_CONFIG.showNavBar === false) Navbar.handleToggleNavBarButton();
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

const Chat = function() {
    function storeChatInState() {
        try {
            const chatNode = Utils.getNodeByQuerySelector("section", "class", "ScSecondaryContent-sc-1swxymf-2");
            if (!chatNode) throw new Error("Failed to store chat in state.");

            CHAT_NODE = chatNode;
        } catch (error) {
            console.error(error.message);
        }
    }

    function handleExpandChatButton() {
        if (IS_CHAT_MINIMAL === false) {
            shrinkChat();
        } else {
            expandChat();
        }
    }

    // TODO: Rename related functions to be shrink/expand? This hides the top and bottom
    // chat sections (stream info, tags, chat input).
    function expandChat() {
        chatTop(false);
        chatBottom(false);
        IS_CHAT_MINIMAL = !IS_CHAT_MINIMAL;
    }

    // TODO: Rename related functions to be shrink/expand? This restores the top and bottom
    // chat sections (stream info, tags, chat input).
    function shrinkChat() {
        chatTop(true);
        chatBottom(true);
        IS_CHAT_MINIMAL = !IS_CHAT_MINIMAL;
    }

    function removeChat() {
        const chatSelector = "section[class^='ScSecondaryContent-sc-1swxymf-2']";
        const chatNode = document.querySelector(chatSelector);
        if (chatNode === null) return console.error("Chat section is null.");

        chatNode.remove();
        IS_CHAT_SHOWING = false;
    }

    function addChat() {
        const mainContentSelector = "div[class^='ScPlayerLayout-sc-1swxymf-0']";
        const mainContentNode = document.querySelector(mainContentSelector);
        if (mainContentNode === null) return console.error("Main content node is null.");

        mainContentNode.appendChild(CHAT_NODE);

        IS_CHAT_SHOWING = true;

        if (IS_CHAT_MINIMAL === true) {
            chatTop(true);
            chatBottom(true);
        } else {
            chatTop(false);
            chatBottom(false);
        }
    }

    function chatTop(show=true) {
        let displayValue = (show === true) ? "block" : "none";

        try {
            const chatTopInfoSelector = "div[class='tw-border-b tw-pd-1']";
            const chatTopInfoNode = document.querySelector(chatTopInfoSelector);
            chatTopInfoNode.style.cssText = `display: ${displayValue};`;
        } catch (error) {
            console.error("Chat top toggle failed.", error);
        }
    }

    function chatBottom(show=true) {
        let displayValue = (show === true) ? "block" : "none";

        try {
            const chatInputSelector = "div[class='tw-flex-shrink-0']";
            const chatInputNode = document.querySelector(chatInputSelector);
            chatInputNode.style.cssText = `display: ${displayValue};`;
        } catch (error) {
            console.error("Chat bottom toggle failed.", error.message);
        }
    }

    async function handlePopoutChat() {
        // Remove chat header.
        //     if (USER_CONFIG.removePopoutChatHeader) {
        //         let popOutChatHeaderSelector = "stream-chat-header tw-align-items-center tw-border-b";
        //         popOutChatHeaderSelector += " tw-c-background-base tw-flex tw-flex-shrink-0 tw-full-width";
        //         popOutChatHeaderSelector += " tw-justify-content-center tw-pd-l-1 tw-pd-r-1";
        //         removeNode("div", "class", popOutChatHeaderSelector, "Popout Chat Header");
        //     }

        // Remove chat leaderboard.
        //     if (USER_CONFIG.removePopoutChatLeaderboard) {
        //         const popoutChatLeaderboardSelector = "div[class^='channel-leaderboard tw-z-default']";
        //         const popoutChatLeaderboardNode = document.querySelector(popoutChatLeaderboardSelector);
        //         popoutChatLeaderboardNode.style.cssText = "display: none !important";
        //     }

        // Remove poll.
        //     if (USER_CONFIG.removePopoutChatPoll) {
        //         let popoutChatPollSelector = "tw-absolute tw-full-width tw-z-above";
        //         removeNode("div", "class", popoutChatPollSelector, "Popout Chat Poll");
        //     }

        // Remove chat input.
        if (USER_CONFIG.removePopoutChatInput) {
            const popoutChatInputSelector = "div[class^='chat-input']";
            const popoutChatNode = document.querySelector(popoutChatInputSelector);
            popoutChatNode.style.cssText = "display: none !important";
            // Chat needs this node to show chat. Adding a pause works, but hiding it
            // is better.
            //         removeNode("div", "class", popoutChatInputSelector, "Popout Chat Input");
        }
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

    return {
        storeChatInState,
        handleExpandChatButton,
        removeChat,
        addChat,
        handlePopoutChat,
        clickMoreMsgBelowAfterResize
    }
}();

const Button = function() {
    function createToggleChat() {
        let btn = document.createElement("button");
        btn.type = "button";
        btn.id = "toggle-chat";
        btn.innerHTML = "Chat";
        btn.title = "Toggle Chat";
        const css = `border-radius: 4px;
                     padding: 6px 6px;
                     margin-left: 6px;
                     font-weight: bold;
                     user-select: none;
                     background-color: #4a4a4a;
                     -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                    `;
        btn.style.cssText = css;
        btn.onclick = Button.handleToggleChat;

        return btn;
    }

    function createToggleNavBar() {
        let btn = document.createElement("button");
        btn.type = "button";
        btn.id = "toggle-nav-bar";
        btn.className = "overlay-button navbar";
        btn.innerHTML = "^";
        btn.onclick = Navbar.handleToggleNavBarButton;

        return btn;
    }

    function createToggleChatSm() {
        let btn = document.createElement("button");
        btn.type = "button";
        btn.id = "toggle-chat-btn";
        btn.className = "overlay-button chat";
        btn.innerHTML = ">";
        btn.onclick = Button.handleToggleChat;

        return btn;
    }

    function createExpandChat() {
        const btn = document.createElement("button");
        btn.id = "expand-chat";
        btn.type = "button";
        btn.innerHTML = "i";
        btn.title = "Toggle chat input and chat top stream info";
        const css = `margin-left: 6px;
                     /*background-color: #9147ff;*/
                     border-radius: 4px;
                     padding: 6px 6px;
                     font-weight: bold;
                     user-select: none;
                     -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                    `;
        btn.style.cssText = css;
        btn.onclick = Chat.handleExpandChatButton;

        return btn;
    }

    function createOutgoingChat() {
        let btn = document.createElement("button");
        btn.type = "button";
        btn.id = "outgoing-chat";
        btn.innerHTML = "+";
        btn.title = "Open chat in new tab";
        const css = `border-radius: 4px;
                     padding: 6px 6px;
                     font-weight: bold;
                     user-select: none;
                     background-color: #4a4a4a;
                     -webkit-tap-highlight-color:  rgba(255, 255, 255, 0);
                    `;
        btn.style.cssText = css;
        btn.onclick = handleOutgoingChat;

        return btn;
    }

    function handleOutgoingChat() {
        // Get streamer's name from URL.
        const streamerName = window.location.href.split("/")[3];

        let url = `https://www.twitch.tv/popout/${streamerName}`;
        url += `/chat?no-mobile-redirect=true`;

        // Open chat in new tab.
        window.open(url);
    }

    function handleToggleChat() {
        if (IS_CHAT_SHOWING === true) {
            Chat.removeChat();
        } else {
            Chat.addChat(CHAT_NODE);
        }

        Player.moveVideo();
    }

    return {
        createToggleChat,
        createToggleNavBar,
        createToggleChatSm,
        createExpandChat,
        createOutgoingChat,
        handleOutgoingChat,
        handleToggleChat
    }
}();

const Navbar = function() {
    function removeInAppButton() {
        try {
            const openInAppButtonNode = Utils.getNodeByClassName("open-in-app");
            if (!openInAppButtonNode) throw new Error("Failed to remove 'Open in App 1' button.");
            openInAppButtonNode.remove();
        } catch (error) {
            console.error(error.message);
        }

        try {
            const openInAppButtonNode2 = Utils.getNodeByClassName("ScCoreButton-sc-1qn4ixc-0 ScCoreButtonPrimary-sc-1qn4ixc-1 gJeMUd eBYHwz tw-core-button");
            if (!openInAppButtonNode2) throw new Error("Failed to remove 'Open in App 2' button.");
            openInAppButtonNode2.remove();
        } catch (error) {
            console.error(error.message);
        }
    }

    function remove() {
        if (NAVBAR_NODE === null) return console.error("Nav bar node is null.");

        NAVBAR_NODE.remove();

        IS_NAVBAR_SHOWING = false;
    }

    function add() {
        try {
            const navParentNode = Utils.getNodeByClassName("tw-absolute tw-bottom-0 tw-left-0 tw-right-0 tw-top-0");
            if (!navParentNode) throw new Error("Failed to add navigation bar");
            Utils.attachNode("prepend", navParentNode, NAVBAR_NODE);
            IS_NAVBAR_SHOWING = true;
        } catch (error) {
            console.error(error.message);
        }
    }

    function storeInState() {
        try {
            const navBarNode = Utils.getNodeByQuerySelector("nav", "class", "ScTopNavContainer-sc-");
            if (!navBarNode) throw new Error("Failed to store navigation bar in state");

            NAVBAR_NODE = navBarNode;
        } catch (error) {
            console.error(error.message);
        }
    }

    function handleToggleNavBarButton() {
        if (IS_NAVBAR_SHOWING === true) {
            Navbar.remove();
        } else {
            Navbar.add();
        }

        Utils.moveContent();
    }

    return {
        removeInAppButton,
        remove,
        add,
        storeInState,
        handleToggleNavBarButton
    }
}();

const Player = function() {
    async function unmute() {
        for (let i=0; i<USER_CONFIG.unmuteAttempts; i++) {
            const tapToMuteNode = getUnmuteNode();
            await Utils.pause(USER_CONFIG.unmuteInterval);

            if (tapToMuteNode !== null) {
                tapToMuteNode.click();
                HAS_UNMUTED = true;
                console.log(`Successfully unmuted after ${i} tries.`);
                break;
            }

            if (i === (USER_CONFIG.unmuteAttempts-1)) return console.error(`Failed to unmute after ${i} tries.`);
        }
    }

    // Cannot use getNodeByQuerySelector()
    function getUnmuteNode() {
        const tapToMuteSelector = "p[class='tw-c-text-overlay']";
        const tapToMuteNode = document.querySelector(tapToMuteSelector);
        if (tapToMuteNode === null) return null;

        return tapToMuteNode;
    }

    function disableClickToPause() {
        try {
            const node = Utils.getNodeByClassName("pulsar-mp-container");
            if (!node) throw new Error("Click to pause node is null.");

            node.onclick = () => false;
        } catch (error) {
            console.error("Failed to disable click to video to pause");
        }
    }

    // Move video to take up the entire width when chat is removed. It also horizontally
    // centers the video.
    function moveVideo() {
        const videoSelector = "section[class^='ScPlayerContainer-sc-1swxymf-1']";
        const videoNode = document.querySelector(videoSelector);
        if (!videoNode) return console.error("Video node is null.");

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
                     padding-bottom: 0px !important;
                    `;

        videoNode.style.cssText = css;
    }

    return {
        unmute,
        getUnmuteNode,
        disableClickToPause,
        moveVideo
    }
}();

let Utils = function() {
    function removeNode(element, attribute, selector, metaErrorLabel="") {
        const node = document.querySelector(`${element}[${attribute}="${selector}"]`);
        if (metaErrorLabel !== "") metaErrorLabel += " ";
        if (node === null) return console.error(`Remove ${metaErrorLabel}node failed.`);

        node.remove();
    }

    function attachNode(type, sourceNode, attachingNode) {
        try {
            if (!sourceNode) throw new Error(`Invalid node argument on function ${arguments.callee.name}()`);
            if (type !== "prepend" && type !== "append") throw new Error(`Invalid type argument on function ${arguments.callee.name}()`);
            if (type === "prepend") sourceNode.prepend(attachingNode);
            if (type === "append") sourceNode.append(attachingNode);
        } catch (error) {
            console.error(error.message);
        }
    }

    function getNodeByClassName(selector) {
        try {
            const node = document.getElementsByClassName(selector)[0];
            if (!node) throw new Error(`Failed to get node by class name with selector "${selector}"`);
            return node;
        } catch (error) {
            console.error(error.message);
        }
    }

    function getNodeByQuerySelector(element, attribute, selector, metaErrorLabel="") {
        try {
            const node = document.querySelector(`${element}[${attribute}^="${selector}"]`);
            if (!node) throw new Error(`Failed to get node by query selector with selector "${metaErrorLabel}"`);
            return node;
        } catch (error) {
            console.error(error.message);
        }
    }

    function pause(ms) {
        return new Promise(resolve => {
            setTimeout(() => { resolve() }, ms);
        });
    }

    // Move entire content up after removing top navigation bar.
    function moveContent() {
        try {
            const contentNode = Utils.getNodeByQuerySelector("main", "class", "ScMain-iwf30a-0");
            if (!contentNode) throw new Error("Failed to move content");

            if (IS_NAVBAR_SHOWING === true) {
                contentNode.style.marginTop = "50px"
                contentNode.style.height = "calc(100% - 50px)";
            } else {
                contentNode.style.marginTop = "0px";
                contentNode.style.height = "100%";
            }
        } catch (error) {
            console.error(error.message);
        }
    }

    return {
        removeNode,
        attachNode,
        getNodeByClassName,
        getNodeByQuerySelector,
        pause,
        moveContent
    }
}();