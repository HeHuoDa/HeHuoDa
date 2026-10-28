#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <linux/sched.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

/* No capabilities or namespaces: restrictions are inherited across exec and threads. */
static int allow_read(int ruleset, const char *path) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) return -1;
  struct landlock_path_beneath_attr rule = {
    .allowed_access = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |
                      LANDLOCK_ACCESS_FS_EXECUTE,
    .parent_fd = fd
  };
  int result = syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
  close(fd);
  return result;
}
#define DENY(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##n, 0, 1), \
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
int main(int argc, char **argv) {
  if (argc < 2) return 125;
  int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 3) { fprintf(stderr,"landlock ABI 3 required\n"); return 125; }
  struct landlock_ruleset_attr attr = { .handled_access_fs =
    LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE |
    LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
    LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
    LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
    LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER | LANDLOCK_ACCESS_FS_TRUNCATE };
  int ruleset = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (ruleset < 0) return 125;
  const char *paths[] = {"/app/dist", "/app/node_modules", "/usr", "/lib", "/lib64"};
  for (unsigned i = 0; i < sizeof(paths)/sizeof(paths[0]); i++)
    if (allow_read(ruleset, paths[i]) < 0) { perror("landlock rule"); return 125; }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
      syscall(SYS_landlock_restrict_self, ruleset, 0)) { perror("landlock restrict"); return 125; }
  close(ruleset);
#if defined(__x86_64__)
#define EXPECTED_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define EXPECTED_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported sandbox architecture
#endif
  struct sock_filter code[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, EXPECTED_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
#endif
    DENY(io_uring_setup), DENY(io_uring_enter), DENY(io_uring_register),
    /* glibc falls back to clone for threads; processes may not escape the timeout. */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, CLONE_THREAD, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
#ifdef __NR_fork
    DENY(fork), DENY(vfork),
#endif
    DENY(socket), DENY(socketpair), DENY(connect), DENY(bind), DENY(listen),
    DENY(accept), DENY(accept4), DENY(sendto), DENY(sendmsg), DENY(sendmmsg),
    DENY(ptrace), DENY(process_vm_readv), DENY(process_vm_writev),
    DENY(mount), DENY(umount2), DENY(unshare), DENY(setns),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { .len = sizeof(code)/sizeof(code[0]), .filter = code };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) { perror("seccomp"); return 125; }
  execv(argv[1], &argv[1]);
  perror("sandbox exec");
  return 125;
}
