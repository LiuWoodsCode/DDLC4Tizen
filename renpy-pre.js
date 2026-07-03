/*

Copyright 2019-2021 Sylvain Beucler
Copyright 2022 Teyut <teyut@free.fr>
Copyright 2019-2022 Tom Rothamel <pytom@bishoujo.us>

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software,
and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

Module = window.Module || { };
Module.preRun = Module.preRun || [ ];

(function () {

    /***************************************************************************
     * Report messages, errors, and progress.
     **************************************************************************/

    // The div containing the status and progress bar.
    let statusDiv = document.getElementById("statusDiv");
    let statusTextDiv = document.getElementById("statusTextDiv");
    let statusProgress = document.getElementById("statusProgress");

    // Presplash block
    let presplash = document.getElementById('presplash');

    // The timeout before the status div hides itself.
    let statusTimeout = null;

    // The status message.
    let statusText = "";

    // How long before the status div starts hiding, in seconds.
    const STATUS_TIMEOUT = 5000;

    // The last time the progress was updated.
    let lastProgressTime = 0;

    // Has an error been reported?
    let errorReported = false;

    // Should output only go to the console?
    let printConsoleOnly = false;

    /**
     * Hide the status div. Once it's hidden, clears the status text.
     */
    function hideStatus() {
        if (errorReported) {
            return;
        }

        statusDiv.classList.remove("visible");
        statusDiv.classList.add("hidden");

        statusTimeout = setTimeout(() => {
            statusText = "";
        }, 250);
    }

    /**
     * Show the status div.
     */
    function showStatus() {
        statusDiv.classList.remove("hidden");
        statusDiv.classList.add("visible");
        statusTextDiv.scrollTop = statusTextDiv.scrollHeight;
        statusProgress.style.display = "none";
    }

    /**
     * Cancels the timeout that hides the status div.
     */
    function cancelStatusTimeout() {
        if (statusTimeout) {
            clearTimeout(statusTimeout);
            statusTimeout = null;
        }
    }

    /**
     * Start the timeout that hides the status div.
     */
    function startStatusTimeout() {
        cancelStatusTimeout();
        statusTimeout = setTimeout(hideStatus, STATUS_TIMEOUT);
    }

    function printCommon(s) {

        cancelStatusTimeout();
        lastProgressTime = 0;

        if (statusText) {
            statusText += "<br>";
        }

        if (s == "" && !errorReported) {
            statusText = "";
            return;
        }

        for (let i of s.split("\n")) {
            if (i.length > 0) {
                console.log(i);
            }
        }

        if (printConsoleOnly) {
            return;
        }

        s = String(s);
        s = s.replace(/&/g, "&amp;");
        s = s.replace(/</g, "&lt;");
        s = s.replace(/>/g, "&gt;");
        s = s.replace('\n', '<br />', 'g');

        statusText += s;

        let lines = statusText.split("<br />");
        if (lines.length > 200) {
            lines = lines.slice(lines.length - 200);
            statusText = lines.join("<br />");
        }

        statusTextDiv.innerHTML = statusText;

        showStatus();
    }

    /**
     * Reports a message that will eventually be hidden.
     */
    function printMessage(s) {

        if (s.startsWith("warning: ") || s.startsWith("wasm streaming compile failed") || s.startsWith("falling back to ArrayBuffer") ) {
            console.log(s);
            return;
        }

        printCommon(s);
        startStatusTimeout();
    }

    function formatErrorValue(value) {
        if (value === undefined || value === null) {
            return "";
        }

        if (typeof value === "string") {
            return value;
        }

        try {
            return JSON.stringify(value, null, 2);
        } catch (e) {
            return String(value);
        }
    }

    function getValueSafely(label, callback) {
        try {
            let value = callback();
            if (value === undefined || value === null || value === "") {
                return "Unavailable";
            }
            return String(value);
        } catch (e) {
            console.warn("Could not read " + label + ":", e);
            return "Unavailable";
        }
    }

    function getTizenCapability(name) {
        return getValueSafely(name, () => {
            if (!window.tizen || !tizen.systeminfo || !tizen.systeminfo.getCapability) {
                return null;
            }
            return tizen.systeminfo.getCapability(name);
        });
    }

    function collectSystemInfo() {
        let model = getValueSafely("Samsung TV model", () => {
            if (window.webapis && webapis.productinfo && webapis.productinfo.getModel) {
                return webapis.productinfo.getModel();
            }

            if (window.tizen && tizen.systeminfo && tizen.systeminfo.getCapability) {
                return tizen.systeminfo.getCapability("http://tizen.org/system/model_name")
                    || tizen.systeminfo.getCapability("http://tizen.org/system/model");
            }

            return null;
        });

        let firmware = getValueSafely("Samsung TV firmware", () => {
            if (window.webapis && webapis.productinfo && webapis.productinfo.getFirmware) {
                return webapis.productinfo.getFirmware();
            }
            return null;
        });

        let tizenVersion = getTizenCapability("http://tizen.org/feature/platform.version");
        let build = firmware;

        return {
            "Model": model,
            "Tizen version": tizenVersion,
            "Tizen build": build,
            "User agent": getValueSafely("user agent", () => navigator.userAgent),
            "Language": getValueSafely("language", () => {
                if (navigator.languages && navigator.languages.length) {
                    return navigator.languages.join(", ");
                }
                return navigator.language || navigator.userLanguage;
            })
        };
    }

    function appendTextElement(parent, tagName, text, className) {
        let element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        element.textContent = text;
        parent.appendChild(element);
        return element;
    }

    function appendInfoList(parent, values) {
        let dl = document.createElement("dl");
        dl.className = "renpy-error-info";

        for (let name in values) {
            let dt = document.createElement("dt");
            dt.textContent = name;
            dl.appendChild(dt);

            let dd = document.createElement("dd");
            dd.textContent = values[name] || "Unavailable";
            dl.appendChild(dd);
        }

        parent.appendChild(dl);
    }

    function updateBuildInfo(container) {
        if (!window.tizen || !tizen.systeminfo || !tizen.systeminfo.getPropertyValue) {
            return;
        }

        try {
            tizen.systeminfo.getPropertyValue("BUILD", (buildInfo) => {
                let values = { };

                if (buildInfo.model) {
                    values["Model"] = buildInfo.model;
                }

                if (buildInfo.buildVersion) {
                    values["Tizen build"] = buildInfo.buildVersion;
                }

                if (Object.keys(values).length) {
                    container.innerHTML = "";
                    appendInfoList(container, Object.assign(collectSystemInfo(), values));
                }
            }, (error) => {
                console.warn("Could not read Tizen build info:", error);
            });
        } catch (e) {
            console.warn("Could not request Tizen build info:", e);
        }
    }

    function showErrorPage(message, details) {
        let systemInfo = collectSystemInfo();

        document.title = "DDLC Tizen Error";
        document.documentElement.style.background = "#161616";
        document.body.innerHTML = "";
        document.body.style.margin = "0";
        document.body.style.background = "#161616";
        document.body.style.color = "#f4f1f1";
        document.body.style.fontFamily = "Arial, Helvetica, sans-serif";

        let page = document.createElement("main");
        page.style.boxSizing = "border-box";
        page.style.minHeight = "100vh";
        page.style.padding = "8vh 8vw";
        page.style.background = "#161616";
        page.style.color = "#f4f1f1";
        page.style.lineHeight = "1.45";

        appendTextElement(page, "h1", "An error occurred");
        appendTextElement(page, "p", "Doki Doki Literature Club! for Tizen ran into a problem and cannot continue.");

        appendTextElement(page, "h2", "Error");
        appendTextElement(page, "pre", message, "renpy-error-block");

        if (details) {
            appendTextElement(page, "h2", "Details");
            appendTextElement(page, "pre", details, "renpy-error-block");
        }

        appendTextElement(page, "h2", "Samsung TV system info");
        let systemInfoContainer = document.createElement("section");
        appendInfoList(systemInfoContainer, systemInfo);
        page.appendChild(systemInfoContainer);

        appendTextElement(page, "h2", "Report this bug");
        appendTextElement(page, "p", "Please take a screenshot of this screen and report the bug at:");

        let link = document.createElement("a");
        link.href = "https://github.com/LiuWoodsCode/DDLC_Tizen";
        link.textContent = "https://github.com/LiuWoodsCode/DDLC_Tizen";
        link.style.color = "#ff7aa8";
        link.style.wordBreak = "break-all";
        page.appendChild(link);

        let style = document.createElement("style");
        style.textContent = [
            "main h1 { margin: 0 0 0.5em; font-size: 42px; }",
            "main h2 { margin: 1.4em 0 0.45em; font-size: 32px; }",
            "main p { max-width: 900px; font-size: 22px; }",
            ".renpy-error-block { max-width: 1000px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: #252525; color: #fff; padding: 16px; border-left: 5px solid #ff7aa8; font-size: 16px; }",
            ".renpy-error-info { display: grid; grid-template-columns: minmax(160px, 240px) minmax(0, 1fr); gap: 8px 18px; max-width: 1100px; margin: 0; }",
            ".renpy-error-info dt { color: #ffb4cf; font-weight: bold; }",
            ".renpy-error-info dd { margin: 0; word-break: break-word; }",
            "@media (max-width: 700px) { main h1 { font-size: 32px; } .renpy-error-info { grid-template-columns: 1fr; } .renpy-error-info dd { margin-bottom: 8px; } }"
        ].join("\n");

        document.head.appendChild(style);
        document.body.appendChild(page);

        updateBuildInfo(systemInfoContainer);
    }

    function reportError(s, e, details) {
        if (errorReported) {
            return;
        }

        errorReported = true;

        let message = String(s);

        if (e) {
            console.error(e, e.stack);
            message += ": " + (e.message || e);
        }

        let detailText = formatErrorValue(details);
        if (e && e.stack) {
            detailText = detailText ? detailText + "\n\n" + e.stack : e.stack;
        }

        let fullMessage = message;

        printCommon(fullMessage);

        alert(fullMessage);

        showErrorPage(fullMessage, detailText);

        try {
            Module.addRunDependency("error");
        } catch (e) {
            window.stop();
        }
    }

    function reportUnhandledError(event) {
        if (event.target && event.target !== window) {
            let target = event.target;
            let tagName = target.tagName ? target.tagName.toLowerCase() : "resource";

            if (tagName != "script" && tagName != "link") {
                return;
            }

            reportError("Could not load " + tagName + ".", null, {
                "URL": target.src || target.href || "Unavailable",
                "Element": tagName
            });
            return;
        }

        reportError("Unhandled JavaScript exception", event.error, {
            "Message": event.message || "Unavailable",
            "Source": event.filename || "Unavailable",
            "Line": event.lineno || "Unavailable",
            "Column": event.colno || "Unavailable"
        });
    }

    function reportUnhandledRejection(event) {
        let reason = event.reason;
        let details = reason instanceof Error ? null : reason;

        reportError("Unhandled promise rejection", reason instanceof Error ? reason : null, details);
    }

    function wrapWebAssemblyPromise(name, f) {
        return function () {
            try {
                let result = f.apply(this, arguments);

                if (result && typeof result.then == "function") {
                    return result.catch((e) => {
                        reportError("WebAssembly " + name + " failed", e, {
                            "Operation": name
                        });
                        throw e;
                    });
                }

                return result;
            } catch (e) {
                reportError("WebAssembly " + name + " failed", e, {
                    "Operation": name
                });
                throw e;
            }
        };
    }

    function installGlobalErrorReporting() {
        window.addEventListener("error", reportUnhandledError, true);
        window.addEventListener("unhandledrejection", reportUnhandledRejection);

        if (typeof WebAssembly != "object") {
            return;
        }

        for (let name of ["compile", "compileStreaming", "instantiate", "instantiateStreaming"]) {
            if (typeof WebAssembly[name] == "function") {
                try {
                    WebAssembly[name] = wrapWebAssemblyPromise(name, WebAssembly[name]);
                } catch (e) {
                    console.warn("Could not wrap WebAssembly." + name + ":", e);
                }
            }
        }
    }

    installGlobalErrorReporting();

    /**
     * Updates the progress bar.
     */
    function progress(done, total) {

        if (errorReported) {
            return;
        }

        let now = +Date.now();

        if ((now < lastProgressTime + 32) && (done < total) && (done > 1)) {
            return
        }

        lastProgressTime = now;

        cancelStatusTimeout();
        showStatus();

        if (total) {
            statusProgress.value = done;
            statusProgress.max = total;
            statusProgress.style.display = "block";
        }

        startStatusTimeout();

    }

    window.progress = progress;

    Module.print = printMessage;
    Module.printErr = printMessage;


    /***************************************************************************
     * Browser capability checks.
     **************************************************************************/

    // Report the lack of WebAssembly support.
    if (typeof WebAssembly !== 'object') {
        reportError("This browser does not support WebAssembly.", null, "WebAssembly is required to run the Ren'Py engine.");
        return;
    }

    // Report the lack of the fetch function.
    if (typeof fetch !== 'function') {
        reportError("This browser does not support fetch.", null, "fetch() is required to download game data.");
        return;
    }

    /***************************************************************************
     * Emscripten initialization and termination.
     **************************************************************************/

    /** Set up the canvas. */
    let canvas = document.getElementById('canvas');

    /** Set when the webGlContext is lost. */
    window.webglContextLost = false;

    /** Set when the webGlContext is restored. Cleared by Ren'Py in core.py. */
    window.webglContextRestored = false;

    canvas.addEventListener("webglcontextlost", (e) => {
        window.webglContextRestored = false;
        window.webglContextLost = true;
        e.preventDefault();
    }, false);

    canvas.addEventListener("webglcontextrestored", (e) => {
        window.webglContextLost = false;
        window.webglContextRestored = true;
    }, false);


    canvas.addEventListener('mouseenter', function (e) { window.focus() });

    canvas.addEventListener('click', function (e) { window.focus() });

    Module.canvas = canvas;

    window.presplashEnd = () => {
        presplash.remove();
        cancelStatusTimeout();
        hideStatus();
    };

    window.atExit = () => {
        canvas.remove();
        reportError("The game exited unexpectedly.", null, "Ren'Py called the exit handler before the web page was closed.");
    };

    Module.onAbort = () => {
        canvas.remove();
        reportError("The game aborted unexpectedly.", null, "The WebAssembly runtime reported an abort.");
    };

    /**
     * Initialize the filesystem.
     */
    function initFs() {
        // Create the save directory, and mount the IDBFS filesystem.
        try {
            Module.addRunDependency('initFs');
            FS.mkdir('/home/web_user/.renpy');
            FS.mount(IDBFS, {}, '/home/web_user/.renpy');
            FS.syncfs(true, (err) => {
                if (err) {
                    printMessage("Error syncing IDBFS: " + err);
                    printMessage("The game may not be able to save properly.");
                }

                Module.removeRunDependency('initFs');
            });
        } catch (e) {
            reportError("Could not create ~/.renpy/", e, "This happened while setting up Ren'Py save storage.");
        }
    }

    Module.preRun.push(initFs);

    // The size of the data and gamezip files.
    let dataSize = 0;
    let gameZipSize = 0;

    // The number of bytes downloaded.
    let dataDownloaded = 0;
    let gameZipDownloaded = 0;

    // Have we issued the data and gameZip prompts?
    let dataPrompt = false;
    let gameZipPrompt = false;

    function updateDownloadProgress() {
        if (dataSize == 0) {
            return;
        }

        if (dataDownloaded < dataSize || gameZipSize == 0) {
            if (!dataPrompt) {
                printMessage("");
                printMessage("Downloading engine...");
                dataPrompt = true;
            }

            progress(dataDownloaded, dataSize);
            return;
        }

        if (!gameZipPrompt) {
            printMessage("");
            printMessage("Downloading game data...");
            gameZipPrompt = true;
        }

        progress(gameZipDownloaded, gameZipSize);

    }

    Module.setStatus = function (s) {

        var m = s.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);

        if (m) {
            dataDownloaded = parseInt(m[2]);
            dataSize = parseInt(m[4]);
            updateDownloadProgress();
            return;
        }

        console.log(s);
    }

    async function loadGameZip() {

        try {
            let response = await fetch(window.gameZipURL);

            if (!response.ok) {
                reportError("Could not load game.zip: " + response.status + " " + response.statusText, null, {
                    "Requested URL": window.gameZipURL,
                    "Resolved URL": response.url,
                    "HTTP status": response.status,
                    "HTTP status text": response.statusText
                });
                return;
            }

            gameZipSize = parseInt(response.headers.get('Content-Length'), 10);
            if(Number.isNaN(gameZipSize)) gameZipSize = 0;

            let reader = await response.body.getReader();

            let f = FS.open('/game.zip', 'w');

            while (true) {

                let { done, value } = await reader.read();

                if (done) {
                    break;
                }

                FS.write(f, value, 0, value.length);
                gameZipDownloaded += value.length;

                updateDownloadProgress();
            }

            FS.close(f);

        } catch (e) {
            reportError("Could not download game.zip", e, {
                "Requested URL": window.gameZipURL,
                "Bytes downloaded": gameZipDownloaded,
                "Expected bytes": gameZipSize || "Unknown"
            });
        }
    }

    function runLoadGameZip() {
        Module.addRunDependency('loadGameZip');

        loadGameZip().then(() => {
            Module.removeRunDependency('loadGameZip');
        });

    }

    Module['preRun'].push(runLoadGameZip);

    /***************************************************************************
     *
     **************************************************************************/

    let cmd_queue = [];
    let cur_cmd = undefined;
    let cmd_debug = false;

    function cmd_log(...args) {
        if (cmd_debug) console.debug(...args);
    }

    /** This functions is called by the wrapper script at the end of script execution. */
    function cmd_callback(result) {
        cmd_log('cmd_callback', result);

        if (cur_cmd === undefined) {
            console.error('Unexpected command result', result);
            return;
        }

        try {
            if (result.error !== undefined) {
                cmd_log('ERROR', result.name, result.error, result.traceback);
                const e = new Error(result.error);
                e.name = result.name;
                e.traceback = result.traceback;
                cur_cmd.reject(e);
            } else {
                cmd_log('SUCCESS', result.data);
                cur_cmd.resolve(result.data);
            }
        } finally {
            cur_cmd = undefined;
            send_next_cmd();
        }
    }

    window._renpy_cmd_callback = cmd_callback;

    /** Prepare and send the next command to be executed if any. */
    function send_next_cmd() {
        if (cmd_queue.length == 0) return

        cur_cmd = cmd_queue.shift();
        cmd_log('send_next_cmd', cur_cmd);

        // Convert script to base64 to prevent having to escape
        // the script content as a Python string
        const script_b64 = btoa(cur_cmd.py_script);
        const wrapper = 'import base64, emscripten, json, traceback;\n'
            + 'try:'
            + "result = None;"
            + "exec(base64.b64decode('" + script_b64 + "').decode('utf-8'));"
            + "result = json.dumps(dict(data=result));"
            + "\n"
            + "except Exception as e:"
            + "result = json.dumps(dict(error=str(e), name=e.__class__.__name__, traceback=traceback.format_exc()));"
            + "\n"
            + "emscripten.run_script('_renpy_cmd_callback(%s)' % (result,));";

        cmd_log(wrapper);

        // Write script to the global variable Ren'Py is monitoring
        window._renpy_cmd = wrapper;
    }

    /** Add a command to the queue and execute it if the queue was empty. */
    function add_cmd(py_script, resolve, reject) {
        const cmd = { py_script: py_script, resolve: resolve, reject: reject };
        cmd_log('add_cmd', cmd);
        cmd_queue.push(cmd);

        if (cur_cmd === undefined) send_next_cmd();
    }

    /* Global definitions */

    /** Execute Python statements in Ren'Py Python's thread. The statements are executed
     * using the renpy.python.py_exec() function, and the value of the "result" variable
     * is passed to the resolve callback. In case of error, an Error instance is passed
     * to the reject callback, with an extra "traceback" property.
     * @param py_script The Python script to execute.
     * @return A promise which resolves with the statements result.
     */
    renpy_exec = function (py_script) {
        return new Promise((resolve, reject) => {
            add_cmd(py_script, resolve, reject);
        });
    };

    window.renpy_exec = renpy_exec;

    /** Helper function to get the value of a Ren'Py variable.
     * @param name The variable name (e.g., "build.name").
     * @return A promise which resolves with the variable value.
     */
    renpy_get = function (name) {
        return new Promise((resolve, reject) => {
            renpy_exec('result = ' + name)
                .then(resolve).catch(reject);
        });
    };

    window.renpy_get = renpy_get;

    /** Helper function to set the value of a Ren'Py variable.
     * @param name The variable name (e.g., "build.name").
     * @param value The value to set. It should either be a basic JS type that
     *              will be converted to JSON, or a Python expression. The raw
     *              parameter must be set to true for the latter case.
     * @param raw (optional) If true, value is a valid Python expression.
     *            Otherwise, it must be a basic JS type.
     * @return A promise which resolves with true in case of success
     *         and fails otherwise.
     */
    renpy_set = function (name, value, raw) {
        let script;
        if (raw) {
            script = name + " = " + value + "; result = True";
        } else {
            // Using base64 as it is unclear if we can use the output
            // of JSON.stringify() directly as a Python string
            script = 'import base64, json; '
                + name + " = json.loads(base64.b64decode('"
                + btoa(JSON.stringify(value))
                + "').decode('utf-8')); result = True";
        }
        return new Promise((resolve, reject) => {
            renpy_exec(script)
                .then(resolve).catch(reject);
        });
    };

    window.renpy_set = renpy_set;


    /***************************************************************************
     * Context menu.
     **************************************************************************/

    const menu = document.getElementById('ContextMenu');

    const contextContainer = document.getElementById('ContextContainer');

    const contextButton = document.getElementById('ContextButton');

    let contextMenuPreviousFocus = null;

    function contextMenuItems() {
        return Array.prototype.filter.call(menu.querySelectorAll('a'), (item) => {
            return item.offsetParent !== null;
        });
    }

    function contextMenuIsShown() {
        return menu.style.display != 'none';
    }

    function focusContextMenuItem(index) {
        const items = contextMenuItems();

        if (!items.length) {
            return;
        }

        const wrappedIndex = (index + items.length) % items.length;
        items[wrappedIndex].focus();
    }

    function openContextMenu() {
        if (contextMenuIsShown()) {
            focusContextMenuItem(0);
            return;
        }

        contextMenuPreviousFocus = document.activeElement;
        menu.style.display = 'block';
        contextContainer.classList.add("shown");
        focusContextMenuItem(0);
    }

    function closeContextMenu() {
        menu.style.display = 'none';
        contextContainer.classList.remove("shown");

        if (contextMenuPreviousFocus && contextMenuPreviousFocus.focus) {
            contextMenuPreviousFocus.focus();
        }
    }

    function toggleContextMenu() {
        if (contextMenuIsShown()) {
            closeContextMenu();
        } else {
            openContextMenu();
        }
    }

    if (window.tizen && tizen.tvinputdevice && tizen.tvinputdevice.registerKey) {
        try {
            tizen.tvinputdevice.registerKey('Info');
        } catch (e) {
            console.warn("Could not register INFO remote key:", e);
        }
    }

    contextButton.addEventListener('click', function (e) {
        toggleContextMenu();
        e.preventDefault();
    });

    menu.addEventListener('click', function (e) {
        if (e.target.tagName == 'A') {
            // Close context menu when a menu item is selected
            closeContextMenu();
        }
    });

    document.addEventListener('keydown', function (e) {
        const keyCode = e.keyCode || e.which;
        const isInfo = e.key == 'Info' || e.code == 'Info' || keyCode == 457;

        if (isInfo) {
            toggleContextMenu();
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (!contextMenuIsShown()) {
            return;
        }

        const items = contextMenuItems();
        const currentIndex = items.indexOf(document.activeElement);

        if (e.key == 'ArrowDown' || e.key == 'ArrowRight' || keyCode == 40 || keyCode == 39) {
            focusContextMenuItem(currentIndex + 1);
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key == 'ArrowUp' || e.key == 'ArrowLeft' || keyCode == 38 || keyCode == 37) {
            focusContextMenuItem(currentIndex - 1);
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key == 'Enter' || e.key == 'OK' || keyCode == 13) {
            if (document.activeElement && document.activeElement.click) {
                document.activeElement.click();
            }
            e.preventDefault();
            e.stopPropagation();
        } else if (e.key == 'Escape' || e.key == 'Back' || keyCode == 27 || keyCode == 10009) {
            closeContextMenu();
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    async function onSavegamesImport(input) {
        reader = new FileReader();
        reader.onload = function (e) {
            FS.writeFile('savegames.zip', new Uint8Array(e.target.result));

            renpy_exec('result = renpy.savelocation.unzip_saves()').then((result) => {
                FS.syncfs(false, function (err) {
                    if (err) {
                        console.trace();
                        console.log(err, err.message);
                        printMessage("Warning: cannot import savegames: write error: " + err.message );
                    } else {
                        renpy_exec('renpy.loadsave.location.scan()').then(result => {
                            printMessage("Saves imported successfully.");
                        }).catch(error => {
                            console.error('Cannot rescan saves folder:', error);
                            printMessage("Saves imported - restart game to apply.");
                        });
                    }
                });
            }).catch(error => {
                console.error('Cannot import savegames', error);
                printMessage("Couldn't import the savegames: " + error.message);
            })
        }
        reader.readAsArrayBuffer(input.files[0])
        input.type = ''; input.type = 'file'; // reset field
    }

    window.onSavegamesImport = onSavegamesImport;

    function onSavegamesExport() {
        renpy_exec('result = renpy.savelocation.zip_saves()').then((ret) => {
            if (ret) {
                FSDownload('savegames.zip', 'application/zip');
                printMessage("Saves exported successfully.\n");
            }
        });
    }

    window.onSavegamesExport = onSavegamesExport;

    function FSDownload(filename, mimetype) {
        console.log('download', filename);
        var a = document.createElement('a');
        a.download = filename.replace(/.*\//, '');
        try {
            a.href = window.URL.createObjectURL(new Blob([FS.readFile(filename)],
                { type: mimetype || '' }));
        } catch (e) {
            Module.print("Error opening " + filename + "\n");
            return;
        }
        document.body.appendChild(a);
        a.click();

        // delay clean-up to avoid iOS issue:
        // The operation couldn’t be completed. (WebKitBlobResource error 1.)
        setTimeout(function () {
            window.URL.revokeObjectURL(a.href);
            document.body.removeChild(a);
        }, 1000);
    }

    window.FSDownload = FSDownload;

    /***************************************************************************
     * Precaching.
     **************************************************************************/

    function loadCache() {
        console.log("Service worker cache loading is disabled.");
    }

    window.loadCache = loadCache;

    function clearCache() {
        localStorage.cacheVersion = -1;
    }

    window.clearCache = clearCache;

    /***************************************************************************
     * Text input.
     **************************************************************************/

    const inputDiv = document.getElementById("inputDiv");
    const inputForm = document.getElementById("inputForm");
    const inputPrompt = document.getElementById("inputPrompt");
    const inputText = document.getElementById("inputText");

    // This stores the input after enter is pressed.
    window.inputResult = null;

    function submitInput(e) {
        e.preventDefault();
        window.inputResult = inputText.value;
    }

    inputForm.addEventListener("submit", submitInput);

    inputDiv.addEventListener("keydown", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("keyup", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("keypress", function (e) { e.stopPropagation(); });

    inputDiv.addEventListener("mousemove", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("mouseup", function (e) { e.stopPropagation(); });

    inputDiv.addEventListener("touchstart", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("touchend", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("touchcancel", function (e) { e.stopPropagation(); });
    inputDiv.addEventListener("touchmove", function (e) { e.stopPropagation(); });

    let inputAllow = null;
    let inputExclude = null;

    inputText.addEventListener("input", (e) => {
        let newValue = "";

        for (let c of inputText.value) {
            if (inputAllow && !inputAllow.includes(c)) {
                continue;
            }

            if (inputExclude && inputExclude.includes(c)) {
                continue;
            }

            newValue += c;
        }

        if (newValue != inputText.value) {
            let end = inputText.selectionEnd;
            inputText.value = newValue;
            inputText.setSelectionRange(end-1, end-1);
        }
    });


    function startInput(prompt, value, allow, exclude, mask) {
        window.inputResult = null;

        inputDiv.classList.remove("hidden");
        inputDiv.classList.add("visible");

        while (inputPrompt.firstChild) {
            inputPrompt.removeChild(inputPrompt.firstChild);
        }

        let promptText = document.createTextNode(prompt);
        inputPrompt.appendChild(promptText);

        inputText.value = value;
        inputText.focus();

        inputAllow = allow;
        inputExclude = exclude;

        if (mask) {
            inputText.type = "password";
        } else {
            inputText.type = "text";
        }

    }

    window.startInput = startInput;

    function endInput() {
        inputDiv.classList.remove("visible");
        inputDiv.classList.add("hidden");
        inputText.blur();
    }

    window.endInput = endInput;

    /***************************************************************************
     * Fetch.
     ***************************************************************************/

    let fetchId = 1;
    let fetchResult = { };

    /**
     * Fetch a file from the server.
     *
     * @param method The HTTP method to use.
     * @param url The URL to fetch.
     * @param inFile The file to send to the server. A string giving the file name, or null for no file.
     * @param outFile The file to write the response to. A string giving the file name, or null for no file.
     * @param inContentType The content type of the file to send to the server. A string giving the content type. Ignored if inFile is null.
     * @param headers A string containing a JSON object that contains the headers to send to the server.
     *
     * @return A string giving the result of the fetch. The first word is the status, which is one of "OK", "ERROR", or "PENDING", followed by the HTTP status code and status text.
     */
    function fetchFile(method, url, inFile, outFile, inContentType, headers) {

        let id = fetchId++;
        fetchResult[id] = "PENDING Fetch in progress.";

        // Ensure headers exists and is not a copy.
        if (headers) {
            headers = JSON.parse(headers)
        } else {
            headers = { };
        }

        headers = { ...headers };

        async function fetchFileWork() {
            try {

                let content = ''

                if (inFile) {
                    headers["Content-Type"] = inContentType || 'application/octet-stream';
                }

                let options = { method: method, headers: headers};

                if (inFile) {
                    options.body = FS.readFile(inFile, { encoding: 'binary' });
                }

                let response = await fetch(url, options);

                if (response.ok) {
                    if (outFile) {
                        let ab = await response.arrayBuffer();
                        FS.writeFile(outFile, new Uint8Array(ab));
                    }

                    fetchResult[id] = "OK " + response.status + " " + response.statusText;
                } else{
                    fetchResult[id] = "ERROR " + response.status + " " + response.statusText;
                }

            } catch (err) {
                fetchResult[id] = "ERROR " + err;
                console.error(err);
            }

        }

        fetchFileWork();

        return id;
    }

    function fetchFileResult(id) {
        let result = fetchResult[id];

        if (! result.startsWith("PENDING")) {
            delete fetchResult[id];
        }

        return result || "ERROR Fetch ID not found.";
    }

    window.fetchFile = fetchFile;
    window.fetchFileResult = fetchFileResult;

    /**
     * Fullscreen support.
     */

    let lastFullscreenTime = 0;

    function isFullscreen() {
        let now = +new Date();
        return document.fullscreenElement ? 1 : 0;
    }

    window.isFullscreen = isFullscreen;

    function setFullscreen(enable) {

        let current = document.fullscreenElement !== null;

        if (enable == current) {
            return;
        }

        let now = +new Date();

        if (lastFullscreenTime + 250 > +new Date()) {
            return;
        }

        lastFullscreenTime = now;

        setTimeout(function () {
            if (enable) {
                let e = document.getElementsByTagName("html")[0];
                e.requestFullscreen().catch(function (error) {
                    lastFullscreenTime = now + 15000;
                });
            } else {
                document.exitFullscreen();
            }
        }, 0);
    }

    window.setFullscreen = setFullscreen;

    /***************************************************************************
     * "Hidden" developer functions.
     **************************************************************************/

    function downloadBytecode() {
        FSDownload('/game/cache/bytecode-311.rpyb', 'application/octet-stream');
    }

    window.downloadBytecode = downloadBytecode;

    function traceSleep() {
        printConsoleOnly = true;
        renpy_exec('import emscripten; emscripten.TRACE = True')
    }

    window.traceSleep = traceSleep;

    function loseContext() {
        let e = canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
        e.loseContext();

        setTimeout(function () {
            e.restoreContext();
        }, 1000);
    }

    window.loseContext = loseContext;


    /***************************************************************************
     * Overlay div handling.
     **************************************************************************/

    let overlayDiv = document.getElementById("overlayDiv");

    for (let eventName of ["mousedown", "mouseup", "mousemove" ]) {
        overlayDiv.addEventListener(eventName, function (e) {
            canvas.dispatchEvent(new MouseEvent(e.type, e));

            if (e.type == "mouseup") {
                overlayDiv.remove();
            }

        });

    };








})();
