# Bridge old Web History URLs to uni H5 hash routes.
location = /home { return 302 "/#/pages/index/index$is_args$args"; }
location = /teams { return 302 "/#/pages/teams/index$is_args$args"; }
location = /teams/new { return 302 "/#/pages/teams/new$is_args$args"; }
location = /profile { return 302 "/#/pages/profile/index$is_args$args"; }
location = /my/favorites { return 302 "/#/pages/my/favorites$is_args$args"; }
location = /notifications { return 302 "/#/pages/notifications/index$is_args$args"; }
location = /about { return 302 "/#/pages/about/index$is_args$args"; }
location = /login { return 302 "/#/pages/auth/login$is_args$args"; }
location = /register { return 302 "/#/pages/auth/register$is_args$args"; }
location = /health { return 302 "/#/pages/health/index$is_args$args"; }
location = /my/teams { return 302 "/#/pages/profile/index?section=teams&$args"; }
location = /my/applications { return 302 "/#/pages/profile/index?section=applications&$args"; }
location ~ ^/home/competitions/([a-z0-9-]+)$ { return 302 "/#/pages/home/competition?id=$1&$args"; }
location ~ ^/teams/([a-z0-9-]+)$ { return 302 "/#/pages/teams/detail?id=$1&$args"; }
