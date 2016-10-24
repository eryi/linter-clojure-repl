(ns linter-clojure-repl-parser
  (:require [eastwood.lint :as lint]
            [eastwood.util :as util]
            [eastwood.analyze-ns :as analyze]
            [clojure.java.io :as io]))

(def ref-opts
  (let  [opts (lint/last-options-map-adjustments {})
         m1 (lint/opts->linters opts lint/linter-name->info
                                                lint/default-linters)]
        (if (m1 :err)
            (throw (Exception. (get-in m1 [:err-data :unknown-linters])))
            (assoc opts :enabled-linters (m1 :linters)))))

(defn namespace->filename [namespace opts]
      (let [source-paths (map str (opts :source-paths))
            filename (str (clojure.string/replace (clojure.string/replace namespace "-" "_") "." "/") ".clj")
            correct-path (first (filter #(.exists (io/as-file (str % "/" filename))) source-paths))]
           (str correct-path "/" filename)))


(defn lint-analyze-results [analyze-results linter-kw opt]
  (if-let [lint-fn (get-in lint/linter-name->info [linter-kw :fn])]
    (try
      (doall (lint-fn analyze-results opt))
      (catch Throwable e e))))

(defn lint-ns [ns-sym opts]
    (let  [_ (doall (map #(ns-unmap ns-sym %) (keys (ns-interns ns-sym))))
           {:keys [analyze-results exception exception-phase exception-form]}
           (analyze/analyze-ns ns-sym :opt opts)]
          (if exception
              {:exception exception
               :meta      (meta exception-form)}
              (reduce (fn [memo linter]
                          (let  [results (lint-analyze-results analyze-results linter opts)]
                                (reduce (fn [memo result]
                                            (if (instance? Throwable result)
                                                (assoc memo :infos (conj (memo :infos) result))
                                                (assoc memo :warnings (conj (memo :warnings) result))))
                                        memo
                                        results)))
                      {:infos [] :warnings []}
                      (opts :enabled-linters)))))

(defn lint-all [opts]
  (let  [_ (atom 0)
         {:keys [namespaces dirs no-ns-form-found-files
                 non-clojure-files] :as m2}
         (lint/opts->namespaces opts _)]
        (if (:err-data m2)
            (reduce-kv (fn [m k v]
                           (assoc m (str (v :dir) "/" k) {:exception (Exception. "namespace-filename-mismatch")}))
                       {}
                       (get-in m2 [:err-data :mismatches]))
            (do (doseq [n namespaces]
                       (create-ns n))
                (reduce (fn [m namespace]
                            (assoc m (namespace->filename namespace opts) (lint-ns namespace opts)))
                        {}
                        namespaces)))))

(defn lint-then-encode [opts]
      (let  [all-results (lint-all opts)]
            (reduce-kv  (fn [m filename result]
                            (if (result :exception)
                                (str m
                                     "@@@@Error%%%%"
                                     (.getMessage (result :exception))
                                     "%%%%"
                                     filename
                                     "%%%%"
                                     (get-in result [:meta :line] 1)
                                     "%%%%"
                                     (get-in result [:meta :column] 1)
                                     "%%%%"
                                     (get-in result [:meta :end-line] 1)
                                     "%%%%"
                                     (get-in result [:meta :end-column] 1))
                                (reduce (fn [m2 warning]
                                            (str  m
                                                  "@@@@Warning%%%%"
                                                  (str (warning :linter) "-" (warning :msg))
                                                  "%%%%"
                                                  filename
                                                  "%%%%"
                                                  (get warning :line 1)
                                                  "%%%%"
                                                  (get warning :column 1)
                                                  "%%%%"
                                                  (get warning :end-line 1)
                                                  "%%%%"
                                                  (get warning :end-column 1)))
                                        m
                                        (result :warnings))))
                        ""
                        all-results)))
