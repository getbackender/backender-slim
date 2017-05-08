
var fs = require('fs');
var gulp = require('gulp');
var connect = require('gulp-connect');
var jsonServer = require('gulp-json-srv');
var urlHandler = require('url');
var proxy = require('proxy-middleware');
var _ = require('underscore');
var spawn = require('spawn-cmd').spawn;
var ls = require('list-directory-contents');

var copyDir = require('copy-dir');
var settings = require('../../settings.json');
if (!settings) {
    throw "could not find any settings.json in root. Please supply one";
}
settings.config = settings.config || {};
settings.path = settings.path || {};
var backenderApp = function () {


    //copyDir.sync('./node_modules/backender/report-x', './report');
    function ensureExists(path, mask, cb) {
        if (typeof mask == 'function') { // allow the `mask` parameter to be optional
            cb = mask;
            mask = 0777;
        }
        fs.mkdir(path, mask, function (err) {
            if (err) {
                if (err.code == 'EEXIST') cb(null); // ignore the error if the folder already exists
                else cb(err); // something else went wrong
            } else cb(null); // successfully created folder
        });
    }

    var reportPath = './report/dalek';
    ensureExists(reportPath, 0744, function (err) {
        if (err) {
            console.log("REPORT FOLDER CREATION ERROR : - ");
            console.log(err);
        }
    });
    var isRootMapEntry = function (o) {
        return o && (o.route == '/');
    };
    var serve = function (maps, port, livereload, middleware) {
        var root = maps.filter(isRootMapEntry)[0];
        connect.server({
            root: root && root.path,
            livereload: livereload,
            port: port,
            middleware: middleware
        });
    };
    var createProxyOptions = function (url, route) {
        var options = urlHandler.parse(url);
        options.route = route;
        return options;
    };
    var mapAndFilterConfig = function (d, path, ext) {
        ext = ext || 'json';
        return d.map(function (o) {
            var name = "";
            var data = {};

            if (typeof o == 'string') {
                if (o.split('.').pop() == ext) {
                    name = o;
                    console.log("provided path : " + __dirname + path);
                    data = require('../..' + ((path && path != '/') ? path : '/') + '/' + o);
                } else {
                    data = false;
                }
            } else {
                if (ext == "json") {
                    data = o;
                }
            }
            return data;
        }).filter(function (o) {
            return o;
        });
    };
    var configs = mapAndFilterConfig(settings.config, settings.path);
    var setupMiddleware = function (port, maps, datasources, datasourcepath, apiverbose) {
        datasources = Array.isArray(datasources) ? datasources : [datasources];
        var datasource = _.reduce(mapAndFilterConfig(datasources, datasourcepath, 'json'), function (a, b) {
            return _.extend(a, b);
        }, {});

        var customRoutes = _.reduce(mapAndFilterConfig(datasources, datasourcepath, 'js'), function (a, b) {
            return _.extend(a, b);
        }, {});

        return function (connect, o) {
            console.log(customRoutes);
            console.log("sppppppp");
            if (datasource && customRoutes) {
                jsonServer.start({
                    port: port,
                    data: datasource,
                    customRoutes: customRoutes
                });
            } else {
                datasource && jsonServer.start({
                    port: port,
                    data: datasource
                });
            }

            return maps.map(function (o) {
                if ((o.endpoint || o.data) && !isRootMapEntry(o)) {
                    return o.data ? proxy(createProxyOptions('http://localhost:' + port + "/" + o.data, o.route)) : proxy(createProxyOptions(o.endpoint, o.route));
                }
            }).filter(function (o) {
                return o;
            });
        };
    };
    var loads = [];
    _.each(configs, function (config) {
        config.localport = config.localport || 8800;
        config.livereload = config.livereload || false;
        config.testdir = config.testdir || './tests';
        config.stepdir = config.stepdir || "./steps";
        config.useheadless = config.useheadless || false;
        config.routes = config.routes || [{
            "route": "/ping",
            "data": "ping"
        }
        ];
        config.datasource = config.datasource || [{
            "ping": ["pong"]
        }
        ];
        config.apiport = config.apiport || config.localport + 1;
        var middleWare = setupMiddleware(config.apiport, config.routes, config.datasource, config.datasourcepath, config.apiverbose);
        middleWare = middleWare || function (req, res, next) {
            next();
        };
        var load = {
            routes: config.routes,
            localport: config.localport,
            livereload: config.livereload,
            middleWare: middleWare,
            testdir: config.testdir,
            stepdir: config.stepdir,
            useheadless: config.useheadless
        };
        loads.push(load);

        config.ref && gulp.task(config.ref, function () {
            serve(load.routes, load.localport, load.livereload, load.middleWare);
        });
    });

    var doruntest = function (testdir, useheadless) {
        ls(testdir, function (err, tree) {
            tree.map(function (o) {
                spawn("dalek " + o + (useheadless ? "" : "  -b chrome ") + "  -r console,html", [], {
                    stdio: 'inherit'
                }).on('exit', function () { });
            });
        });
    };
    var hasInstalledModule = function (name) {
        console.log('checking for ' + name + ' installation....');
        try {
            console.log(require.resolve(name));
            return true;
        } catch (e) {
            console.error(name + " is not found");
            process.exit(e.code);
        }
    };
    var runtest = function (testdir, useheadless) {
        var installCli = function (f) {
            spawn("npm install ", ['dalek-cli ', '--save-dev'], {
                stdio: 'inherit'
            }).on('exit', function () {
                f && f();
            });
        };

        var installChrome = function () {
            spawn("npm install ", ['dalek-browser-chrome ', '--save-dev'], {
                stdio: 'inherit'
            }).on('exit', function () {
                doruntest(testdir, useheadless);
            });
        };

        var installReady = hasInstalledModule('dalek-cli') && hasInstalledModule('dalek-browser-chrome');

        installReady ? doruntest(testdir, useheadless) : installCli(installChrome);
    };

    var runServer = function () {
        _.each(loads, function (load) {
            serve(load.routes, load.localport, load.livereload, load.middleWare);
        });
    };
    var runTests = function () {
        runServer();
        settings.testdir = settings.testdir || "tests";
        settings.testdir && runtest(settings.testdir, settings.useheadless);
    };
    return {
        runServer: runServer,
        runTests: runTests
    };
};

module.exports = {
    init: backenderApp
};