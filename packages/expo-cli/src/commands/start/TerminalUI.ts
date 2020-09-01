import {
  Android,
  Exp,
  Project,
  ProjectSettings,
  ProjectUtils,
  Simulator,
  UrlUtils,
  UserManager,
  UserSettings,
  Webpack,
} from '@expo/xdl';
import chalk from 'chalk';
import openBrowser from 'react-dev-utils/openBrowser';
import readline from 'readline';
import wordwrap from 'wordwrap';

import { loginOrRegisterIfLoggedOutAsync } from '../../accounts';
import log from '../../log';
import urlOpts from '../../urlOpts';
import { startProjectInEditorAsync } from '../utils/EditorUtils';

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const CTRL_L = '\u000C';

const { bold: b, italic: i, underline: u } = chalk;

type StartOptions = {
  reset?: boolean;
  nonInteractive?: boolean;
  nonPersistent?: boolean;
  maxWorkers?: number;
  webOnly?: boolean;
};

const clearConsole = (): void => {
  process.stdout.write(process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H');
};

const printHelp = (): void => {
  const PLATFORM_TAG = ProjectUtils.getPlatformTag('Expo');
  log.newLine();
  log.nested(`${PLATFORM_TAG} Press ${b('?')} to show a list of all available commands.`);
};

const printUsage = async (projectDir: string, options: Pick<StartOptions, 'webOnly'> = {}) => {
  const { dev } = await ProjectSettings.readAsync(projectDir);
  const openDevToolsAtStartup = await UserSettings.getAsync('openDevToolsAtStartup', true);
  const username = await UserManager.getCurrentUsernameAsync();
  const devMode = dev ? 'development' : 'production';
  const androidInfo = `${b`a`} to run on ${u`A`}ndroid (${b`shift+a`} to select the device/emulator)`;
  const iosInfo =
    process.platform === 'darwin'
      ? `${b`i`} to run on ${u`i`}OS simulator (${b`shift+i`} to select the simulator model)`
      : '';
  const webInfo = `${b`w`} to run on ${u`w`}eb`;
  const platformInstructions = [androidInfo, iosInfo, webInfo]
    .filter(Boolean)
    .map(instructions => ` \u203A Press ${instructions}.`)
    .join('\n');
  log.nested(`
${platformInstructions}
 \u203A Press ${b`c`} to show info on ${u`c`}onnecting new devices.
 \u203A Press ${b`d`} to open DevTools in the default web browser.
 \u203A Press ${b`shift-d`} to ${
    openDevToolsAtStartup ? 'disable' : 'enable'
  } automatically opening ${u`D`}evTools at startup.${
    options.webOnly ? '' : `\n \u203A Press ${b`e`} to send an app link with ${u`e`}mail.`
  }
 \u203A Press ${b`p`} to toggle ${u`p`}roduction mode. (current mode: ${i(devMode)})
 \u203A Press ${b`r`} to ${u`r`}estart bundler, or ${b`shift-r`} to restart and clear cache.
 \u203A Press ${b`o`} to ${u`o`}pen the project in your editor.
 \u203A Press ${b`s`} to ${u`s`}ign ${
    username ? `out. (Signed in as ${i('@' + username)}.)` : 'in.'
  }
`);
};

export const printServerInfo = async (
  projectDir: string,
  options: Pick<StartOptions, 'webOnly'> = {}
) => {
  if (options.webOnly) {
    Webpack.printConnectionInstructions(projectDir);
    printHelp();
    return;
  }
  const url = await UrlUtils.constructManifestUrlAsync(projectDir);
  const username = await UserManager.getCurrentUsernameAsync();
  log.newLine();
  log.nested(`  ${u(url)}`);
  log.newLine();
  urlOpts.printQRCode(url);
  const wrap = wordwrap(2, process.stdout.columns || 80);
  const wrapItem = wordwrap(4, process.stdout.columns || 80);
  const item = (text: string): string => '  \u2022 ' + wrapItem(text).trimStart();
  const iosInfo = process.platform === 'darwin' ? `, or ${b('i')} for iOS simulator` : '';
  const webInfo = `${b`w`} to run on ${u`w`}eb`;
  log.nested(wrap(u('To run the app with live reloading, choose one of:')));
  if (username) {
    log.nested(
      item(
        `Sign in as ${i(
          '@' + username
        )} in Expo client on Android or iOS. Your projects will automatically appear in the "Projects" tab.`
      )
    );
  }
  log.nested(item(`Scan the QR code above with the Expo app (Android) or the Camera app (iOS).`));
  log.nested(item(`Press ${b`a`} for Android emulator${iosInfo}, or ${webInfo}.`));
  log.nested(item(`Press ${b`e`} to send a link to your phone with email.`));
  if (!username) {
    log.nested(item(`Press ${b`s`} to sign in and enable more options.`));
  }

  Webpack.printConnectionInstructions(projectDir);
  printHelp();
};

export const startAsync = async (projectRoot: string, options: StartOptions) => {
  const { stdin } = process;
  const startWaitingForCommand = () => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', handleKeypress);
  };

  const stopWaitingForCommand = () => {
    stdin.removeListener('data', handleKeypress);
    stdin.setRawMode(false);
    stdin.resume();
  };

  startWaitingForCommand();

  Simulator.setInteractiveCallback(async (pause: boolean) => {
    if (pause) {
      stopWaitingForCommand();
    } else {
      startWaitingForCommand();
    }
  });

  Android.setInteractiveCallback(async (pause: boolean) => {
    if (pause) {
      stopWaitingForCommand();
    } else {
      startWaitingForCommand();
    }
  });

  UserManager.setInteractiveAuthenticationCallback(async () => {
    stopWaitingForCommand();
    try {
      return await loginOrRegisterIfLoggedOutAsync();
    } finally {
      startWaitingForCommand();
    }
  });

  await printServerInfo(projectRoot, options);

  async function handleKeypress(key: string) {
    if (options.webOnly) {
      switch (key) {
        case 'A':
        case 'a':
          clearConsole();
          log('Trying to open the web project in Chrome on Android...');
          await Android.openWebProjectAsync({
            projectRoot,
            shouldPrompt: !options.nonInteractive && key === 'A',
          });
          printHelp();
          break;
        case 'i':
        case 'I':
          clearConsole();
          log('Trying to open the web project in Safari on the iOS simulator...');
          await Simulator.openWebProjectAsync({
            projectRoot,
            shouldPrompt: !options.nonInteractive && key === 'I',
            // note(brentvatne): temporarily remove logic for picking the
            // simulator until we have parity for Android. this also ensures that we
            // don't interfere with the default user flow until more users have tested
            // this out.
            //
            // If no simulator is booted, then prompt which simulator to use.
            // (key === 'I' || !(await Simulator.isSimulatorBootedAsync())),
          });
          printHelp();
          break;
        case 'e':
          log(chalk.red` \u203A Sending a URL is not supported in web-only mode`);
          break;
      }
    } else {
      switch (key) {
        case 'A':
          clearConsole();
          log('Trying to open the project on Android...');
          await Android.openProjectAsync({ projectRoot, shouldPrompt: true });
          printHelp();
          break;
        case 'a': {
          clearConsole();
          log('Trying to open the project on Android...');
          await Android.openProjectAsync({ projectRoot });
          printHelp();
          break;
        }
        case 'I':
          clearConsole();
          await Simulator.openProjectAsync({
            projectRoot,
            shouldPrompt: true,
          });
          printHelp();
          break;
        case 'i': {
          clearConsole();

          // note(brentvatne): temporarily remove logic for picking the
          // simulator until we have parity for Android. this also ensures that we
          // don't interfere with the default user flow until more users have tested
          // this out.
          //
          // If no simulator is booted, then prompt for which simulator to use.
          // const shouldPrompt =
          //   !options.nonInteractive && (key === 'I' || !(await Simulator.isSimulatorBootedAsync()));

          log('Opening in iOS simulator...');
          await Simulator.openProjectAsync({
            projectRoot,
            shouldPrompt: false,
          });
          printHelp();
          break;
        }
        case 'e': {
          stopWaitingForCommand();
          const lanAddress = await UrlUtils.constructManifestUrlAsync(projectRoot, {
            hostType: 'lan',
          });
          const defaultRecipient = await UserSettings.getAsync('sendTo', null);
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const handleKeypress = (chr: string, key: { name: string }) => {
            if (key && key.name === 'escape') {
              cleanup();
              cancel();
            }
          };
          const cleanup = () => {
            rl.close();
            process.stdin.removeListener('keypress', handleKeypress);
            startWaitingForCommand();
          };
          const cancel = async () => {
            clearConsole();
            printHelp();
          };
          clearConsole();
          process.stdin.addListener('keypress', handleKeypress);
          log('Please enter your email address (press ESC to cancel) ');
          rl.question(
            defaultRecipient ? `[default: ${defaultRecipient}]> ` : '> ',
            async sendTo => {
              cleanup();
              if (!sendTo && defaultRecipient) {
                sendTo = defaultRecipient;
              }
              sendTo = sendTo && sendTo.trim();
              if (!sendTo) {
                cancel();
                return;
              }
              log(`Sending ${lanAddress} to ${sendTo}...`);

              let sent = false;
              try {
                await Exp.sendAsync(sendTo, lanAddress);
                sent = true;
                log(`Sent link successfully.`);
              } catch (err) {
                log(`Could not send link. ${err}`);
              }
              printHelp();
              if (sent) {
                await UserSettings.setAsync('sendTo', sendTo);
              }
            }
          );
          break;
        }
      }
    }

    switch (key) {
      case CTRL_C:
      case CTRL_D: {
        // @ts-ignore: Argument of type '"SIGINT"' is not assignable to parameter of type '"disconnect"'.
        process.emit('SIGINT');
        break;
      }
      case CTRL_L: {
        clearConsole();
        break;
      }
      case '?': {
        await printUsage(projectRoot, options);
        break;
      }
      case 'w': {
        clearConsole();
        log('Attempting to open the project in a web browser...');
        await Webpack.openAsync(projectRoot);
        await printServerInfo(projectRoot, options);
        break;
      }
      case 'c': {
        clearConsole();
        await printServerInfo(projectRoot, options);
        break;
      }
      case 'd': {
        const { devToolsPort } = await ProjectSettings.readPackagerInfoAsync(projectRoot);
        log('Opening DevTools in the browser...');
        openBrowser(`http://localhost:${devToolsPort}`);
        printHelp();
        break;
      }
      case 'D': {
        clearConsole();
        const enabled = !(await UserSettings.getAsync('openDevToolsAtStartup', true));
        await UserSettings.setAsync('openDevToolsAtStartup', enabled);
        log(
          `Automatically opening DevTools ${b(
            enabled ? 'enabled' : 'disabled'
          )}.\nPress ${b`d`} to open DevTools now.`
        );
        printHelp();
        break;
      }
      case 'p': {
        clearConsole();
        const projectSettings = await ProjectSettings.readAsync(projectRoot);
        const dev = !projectSettings.dev;
        await ProjectSettings.setAsync(projectRoot, { dev, minify: !dev });
        log(
          `Metro bundler is now running in ${chalk.bold(
            dev ? 'development' : 'production'
          )}${chalk.reset(` mode.`)}
Please reload the project in the Expo app for the change to take effect.`
        );
        printHelp();
        break;
      }
      case 'r':
      case 'R': {
        clearConsole();
        const reset = key === 'R';
        if (reset) {
          log('Restarting Metro bundler and clearing cache...');
        } else {
          log('Restarting Metro bundler...');
        }
        Project.startAsync(projectRoot, { ...options, reset });
        break;
      }
      case 's': {
        const authSession = await UserManager.getSessionAsync();
        if (authSession?.accessToken) {
          log(chalk.yellow('Please remove the EXPO_TOKEN environment var to sign out.'));
        } else if (authSession?.sessionSecret) {
          await UserManager.logoutAsync();
          log('Signed out.');
        } else {
          stopWaitingForCommand();
          try {
            await loginOrRegisterIfLoggedOutAsync();
          } catch (e) {
            log.error(e);
          } finally {
            startWaitingForCommand();
          }
        }
        printHelp();
        break;
      }
      case 'o':
        log('Trying to open the project in your editor...');
        await startProjectInEditorAsync(projectRoot);
    }
  }
};
