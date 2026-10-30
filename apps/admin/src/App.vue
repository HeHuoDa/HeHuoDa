<script setup lang="ts">
import { useRoute } from "vue-router";
import { ref } from "vue";
import { adminHttp } from "./runtime";
const auth = adminHttp.state;
const logoutError = ref("");
async function logout() {
  try {
    await adminHttp.logout();
  } catch {
    logoutError.value = "退出请求未确认，请重试退出以撤销服务端会话。";
  }
}
import {
  LayoutDashboard,
  Trophy,
  ClipboardCheck,
  Radio,
  History,
  ArrowUpRight,
  Bell,
  Users,
  Flag,
  ListChecks,
  Play,
  Sprout,
  ShieldCheck,
  ChevronRight,
} from "@lucide/vue";
const route = useRoute();
const studentUrl = import.meta.env.VITE_STUDENT_URL;
const menu = [
  { to: "/", text: "工作台", icon: LayoutDashboard },
  { to: "/competitions", text: "比赛管理", icon: Trophy },
  { to: "/ingestion/candidates", text: "候选审核", icon: ClipboardCheck },
  { to: "/ingestion/sources", text: "采集来源", icon: Radio },
  { to: "/ingestion/runs", text: "采集运行", icon: Play },
  { to: "/ingestion/notices", text: "通知版本", icon: Bell },
  { to: "/users", text: "用户管理", icon: Users },
  { to: "/recruitments", text: "招募治理", icon: ListChecks },
  { to: "/reports", text: "举报管理", icon: Flag },
  { to: "/operations", text: "操作记录", icon: History },
];
</script>
<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand" aria-label="禾伙搭管理端首页"
        ><span class="brand-symbol"><Sprout :size="27" /></span
        ><span
          ><strong>禾伙搭</strong><small>管理工作台</small></span
        ></RouterLink
      >
      <div class="nav-caption">内容与运营</div>
      <nav aria-label="管理端主导航">
        <RouterLink
          v-for="item in menu"
          :key="item.to"
          :to="item.to"
          :aria-label="item.text"
          class="nav-link"
          :class="{
            selected:
              item.to === '/'
                ? route.path === '/'
                : route.path === item.to ||
                  route.path.startsWith(item.to + '/'),
          }"
          ><component :is="item.icon" :size="19" /><span>{{
            item.text
          }}</span></RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <a
          v-if="studentUrl"
          :href="studentUrl"
          target="_blank"
          rel="noopener"
          class="student-link"
          >查看学生端 <ArrowUpRight :size="16"
        /></a>
        <div class="workspace-note">
          <ShieldCheck :size="18" /><span
            >管理工作台<small>采集、审核与发布分别确认</small></span
          >
        </div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <span>禾伙搭</span><ChevronRight :size="14" /><strong>{{
            route.meta.title
          }}</strong>
        </div>
        <div class="topbar-actions">
          <template v-if="auth.session"
            ><span>{{ auth.session.displayName }}</span
            ><ElButton @click="logout">退出登录</ElButton></template
          >
          <RouterLink v-else to="/login" class="account-link"
            ><span class="avatar">禾</span><span>管理员入口</span></RouterLink
          >
        </div>
      </header>
      <div v-if="route.query.preview === '1'" class="preview-banner">
        <span
          ><strong>页面预览</strong>
          隔离只读示例，不代表线上数据，不执行真实写入。</span
        >
      </div>
      <p v-if="logoutError" role="alert">
        {{ logoutError }}<ElButton @click="logout">重试退出</ElButton>
      </p>
      <main id="main-content" class="page-container">
        <RouterView :key="auth.generation" />
      </main>
      <footer class="page-footer">
        <span>禾伙搭 · 让合适的人，一起把事情做好。</span><span>管理端</span>
      </footer>
    </div>
  </div>
</template>
