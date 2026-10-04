#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* Measurement only: MONOTONIC time around fork/exec/wait, Linux wait4 RSS in KiB.
 * wait4 includes waited-for descendants; maxrss is the largest individual peak,
 * not the sum of concurrently live processes. stdout/stderr remain unmodified. */
static volatile sig_atomic_t child_pid = -1;
static void stop_child(int signum) {
    if (child_pid > 0) kill(-(pid_t)child_pid, signum);
}

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: bench-runner <metrics.json> <command> [args...]\n");
        return 125;
    }
    struct timespec start, end;
    struct rusage usage;
    struct sigaction action = {0};
    action.sa_handler = stop_child;
    sigemptyset(&action.sa_mask);
    sigaction(SIGTERM, &action, NULL);
    sigaction(SIGINT, &action, NULL);
    if (clock_gettime(CLOCK_MONOTONIC, &start) != 0) return 125;
    pid_t pid = fork();
    if (pid < 0) { perror("fork"); return 125; }
    if (pid == 0) {
        setpgid(0, 0);
        execvp(argv[2], &argv[2]);
        perror(argv[2]);
        _exit(127);
    }
    child_pid = pid;
    setpgid(pid, pid);
    int status = 0;
    pid_t waited;
    do { waited = wait4(pid, &status, 0, &usage); } while (waited < 0 && errno == EINTR);
    child_pid = -1;
    if (waited < 0 || clock_gettime(CLOCK_MONOTONIC, &end) != 0) return 125;
    double elapsed_ms = (end.tv_sec - start.tv_sec) * 1000.0 + (end.tv_nsec - start.tv_nsec) / 1000000.0;
    int signal_number = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
    int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + signal_number;
    FILE *output = fopen(argv[1], "w");
    if (output == NULL) { perror(argv[1]); return 125; }
    fprintf(output, "{\"elapsedMs\":%.6f,\"peakRssKiB\":%ld,\"exitCode\":%d,\"signal\":%d}\n",
        elapsed_ms, usage.ru_maxrss, exit_code, signal_number);
    if (fclose(output) != 0) return 125;
    return 0;
}
