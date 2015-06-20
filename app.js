"use strict";

var express = require( "express" );
var path = require( "path" );
var favicon = require( "serve-favicon" );
var logger = require( "morgan" );
var cookieParser = require( "cookie-parser" );
var bodyParser = require( "body-parser" );
var hbs = require( "hbs" );
var passport = require( "passport" );
var GitHubStrategy = require( "passport-github" ).Strategy;
var session = require( "express-session" );
var flash = require( "connect-flash" );

var routes = require( "./routes/index" );

var app = express();

// view engine setup
app.set( "views", path.join(__dirname, "views" ));
app.set( "view engine", "html" );
app.engine( "html", hbs.__express);

hbs.registerHelper( "json", function(context) {
    return JSON.stringify(context);
});

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + "/public/favicon.ico" ));
app.use(logger( "dev" ));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(require( "less-middleware" )(path.join(__dirname, "public" )));
app.use(express.static(path.join(__dirname, "public" )));

// session
app.use(session({
  secret: "adflkjaguadfnaadfjdfkKDJDFLSHsjkfh49584309dfjdfd"
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());


// routing
app.use( "/", routes);


// Passport session setup.
passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENTID || require( "./local-settings.json" ).gitHub.clientId,
    clientSecret: process.env.GITHUB_CLIENTSECRET || require( "./local-settings.json" ).gitHub.clientSecret,
    callbackURL: process.env.GITHUB_CALLBACKURL || require( "./local-settings.json" ).gitHub.callbackUrl,
    scope: ["user:email", "repo"],
    passReqToCallback: true
  },
  function(req, accessToken, refreshToken, profile, done) {
    process.nextTick( function()
    {
      var user = { token: accessToken, profile: profile };
      req.session.user = user;

      // TODO: associate with local user instead of raw github user
      return done( null, user );
    } );
  }
));

app.get( "/auth/github", passport.authenticate( "github" ));

app.get( "/auth/github/callback",
  passport.authenticate( "github", { successRedirect: "/repos", failureRedirect: "/" }));

app.get( "/logout", function(req, res){
  req.logout();
  res.redirect( "/" );
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error( "Not Found" );
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get( "env" ) === "development" ) {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render( "error", {
      message: err.message,
      error: err,
      layout: "layout.html"
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render( "error", {
    message: err.message,
    error: {},
    layout: "layout.html"
  });
});


module.exports = app;