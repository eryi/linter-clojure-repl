"use babel";

let LinterClojureRepl;
import { CompositeDisposable } from 'atom';
import Rx from 'rxjs/Rx';
import R from 'ramda';
import path from 'path';
import fs from 'fs';
let kill =
  process.platform === 'darwin' ?
    (pid, signal) =>
      ps.exec(util.format("ps a -o pid -o ppid |",
                        + "grep %s | awk '{ print $1 }' |",
                        + "xargs kill -s %s", pid, signal || 'SIGTERM'))

  : require('tree-kill');

import childProcess from 'child_process';
import nrepl from './nrepl-client.js';
import EventEmitter from 'events';

import StatusMessage from './status-message';

let newReplConn$ = Rx.Observable.create(function(subscriber) {
  subscriber.next(false);
  let args = ["repl", ":headless"];
  let cwd = path.resolve(atom.project.getPaths()[0]);

  try {
    if (process.platform === "win32") {
      var replProcess = childProcess.spawn("lein.bat", args, {cwd, shell: true});
    } else {
      // Mac/Linux
      var replProcess = childProcess.spawn("lein", args, {cwd});
    }

    replProcess.once('error', error => subscriber.error(error)
    );

    replProcess.once('exit', code => subscriber.complete()
    );

    Rx.Observable.fromEvent(replProcess.stdout, 'data')
    .map(x => __guard__(x.toString().match(/.*nREPL.*port (\d+)/), x1 => x1[1]))
    .filter(x => x != null)
    .first()
    .do(function(port) {
      let conn = nrepl.connect({port: Number(port), host: 'localhost', verbose: false});
      conn.once('connect', () => subscriber.next(conn));
      conn.once('error', err => subscriber.error(conn));
      return conn.once('finish', () => subscriber.complete());
    })
    .subscribe();

  } catch (error) {
    kill(__guard__(replProcess, x => x.pid));
    subscriber.error(error);
  }

  //teardown
  return () => {
    return kill(__guard__(replProcess, x1 => x1.pid));
  };
});

let cljEval = (replConnection, expr, ns, session) =>
  Rx.Observable.create(subscriber => {
    if (!replConnection) { subscriber.error('Not connected');
    } else {
      replConnection.eval(expr, ns, session, function(err, result) {
        console.log('eval', result)
        let resultErr;
        if (err != null) { return subscriber.error(err.message);
        } else if (resultErr = __guard__(R.find((x => x.err), result), x => x.err)) {
          subscriber.error(resultErr);
        } else {
          let resultStr = result.reduce(function(result, msg) {
            if (msg.value != null) { return result + msg.value; } else { return result; }
          }
          , "");
          subscriber.next(resultStr);
          subscriber.complete();
        }
      });
    }
  });

  //not sure what sessions in REPL does
  let cljEvalWithNewSession = (connection, expr, ns) =>
    Rx.Observable.create(subscriber => {
      if (!connection) { subscriber.error('Not connected');
      } else {
        connection.send({op: 'clone'}, function(err, messages) {
          console.log('clone', messages)
          if (err) subscriber.error(err.message);
          else {
            var newSess = messages && messages[0] && messages[0]["new-session"];
            if (newSess) {
              cljEval(connection, expr, ns, newSess)
              .do((x) => connection.send({op: 'close', session: newSess}))
              .subscribe(subscriber)
            } else {
              subscriber.error('Cannot create new REPL session')
            }
          }
        });
      }
    })

let getParserClj = function() {
    let iterable = atom.packages.getPackageDirPaths();
    iterable.push['~/.atom/dev/packages']
    for (let i = 0; i < iterable.length; i++) {
      let p = iterable[i];
      let possiblePath = p + "/linter-clojure-repl/src/linter_clojure_repl_parser.clj";
      try {
        return fs.readFileSync(possiblePath, {encoding: 'utf-8'});
      } catch (error) {
        //ignore
      }
    }
    throw new Error("Cannot find parser.clj")
  }

export default LinterClojureRepl = {
  subscriptions: null,
  replConnection: false,
  replSubscription: null,
  message: null,
  events: null,
  parserClj: null,

  _eval(expr) { cljEval(this.replConnection, expr, 'linter-clojure-repl-parser')
                .subscribe(function(x){console.log('result', x)}, function(x){console.log('err', x)}); },
  activate(state) {
    this.events = new EventEmitter();
    this.message = new StatusMessage('CLJ-Lint: Not started');

    this.parserClj = getParserClj();

    // Events subscribed to in atom's system can be easily cleaned up with a CompositeDisposable
    this.subscriptions = new CompositeDisposable;

    // Register command that toggles this view
    //this.subscriptions.add(atom.commands.add('atom-workspace', {['linter-clojure-repl:toggle']: () => this.events.emit('toggle')}));
    //this.replSubscription = Rx.Observable.fromEvent(this.events, 'toggle')

    this.replSubscription = Rx.Observable.fromEvent(this.message.item, 'click')
    .mapTo(newReplConn$.materialize())
    .switch()
    .subscribe(connectionNotification => {
      connectionNotification.do(conn => {
        if (conn) {
          cljEval(conn, this.parserClj, 'user')
          .subscribe(result => {
            this.replConnection = conn;
            this.message.setText('CLJ-Lint: Ready', 'text-success');
          }
          , err => {
            atom.notifications.addError('Cannot initialize eastwood: https://github.com/jonase/eastwood');
            console.log(err);
            this.message.setText('CLJ-Lint: Error', 'text-error');
          }
          );
        } else {
          this.replConnection = conn;
          this.message.setText('CLJ-Lint: Starting', 'text-error');
        }
      }

      , err => {
        this.replConnection = false;
        atom.notifications.addError(err.message);
        this.message.setText('CLJ-Lint: Error', 'text-error');
      }
      , () => {
        this.replConnection = false;
        this.message.setText('CLJ-Lint: Stopped', 'text-error');
      });
    });

    return true;
  },

  provideLinter() {
    return {
      name: 'clojure-repl',
      scope: 'project',
      lintOnFly: false,
      grammarScopes: ['source.clojure'],
      lint: textEditor => {
        //editorPath = textEditor.getPath()
        if (!this.replConnection) { return []; }

        return new Promise( (resolve, reject) => {
          this.replConnection.clone
          cljEval(this.replConnection, '(lint-then-encode ref-opts)', 'linter-clojure-repl-parser')
          .subscribe(function(result) {
            if (result.indexOf("@@@@") >= 0) {
              resolve(R.map((x) => {
                let split = x.split("%%%%")
                return {
                  type: split[0],
                  text: split[1],
                  filePath: split[2],
                  range: [[parseInt(split[3]) - 1, parseInt(split[4]) - 1], [parseInt(split[5]) - 1, parseInt(split[6]) - 1]]
                }
              }, result.substring(4 + result.indexOf("@@@@")).split("@@@@")))
            } else if (result.length >3) {
              atom.notifications.addError(result)
              resolve([])
            } else {
              resolve([])
            }
          }, function(err){
            atom.notifications.addError(err)
            resolve([])
          })
        })
      }
    }
  },

  deactivate() {
    this.subscriptions.dispose();
    __guard__(this.replSubscription, x => x.unsubscribe());
    return __guard__(this.message, x1 => x1.remove());
  }
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
