(defproject linter-clojure-repl "0.1.0-SNAPSHOT"
  :description "Stub for loading eastwood"
  :dependencies [[org.clojure/clojure "1.8.0"]]
  :profiles {:dev {:dependencies [[jonase/eastwood "0.2.3" :exclusions [org.clojure/clojure]]]}})
