<script setup lang="ts">
import type { Inventory, ObservedService } from '#shared/types/inventory'
import { fr } from '@nuxt/ui/locale'
import { httpAttemptUrl } from './utils/browser-url'
import {
  describeStopStatus,
  extractStopTargets,
  filterServices,
  formatBytes,
  formatCpu,
  formatDuration,
  getCheckboxAriaLabel,
  getServiceTargetKey,
  getStopDisabledReason,
  isStopEligible,
  pruneSelection,
  sortServices,
  type ProcessStopTarget,
  type SortField,
  type SortOrder,
  type StopResultItem,
} from './utils/process-controls'
import { groupServices } from './utils/service-groups'

useHead({
  title: 'Portscope — Services locaux',
  htmlAttrs: { lang: 'fr' },
  meta: [{ name: 'description', content: 'Les services qui tournent sur votre machine, au même endroit.' }],
})

const query = ref('')
const onlyWithGit = ref(false)
const sortBy = ref<SortField>('port')
const sortOrder = ref<SortOrder>('asc')
const automatic = ref(true)
const now = ref(Date.now())
const inventory = shallowRef<Inventory | null>(null)

const { data, error, status, refresh } = await useFetch<Inventory>('/api/inventory', {
  server: false,
  deep: false,
  timeout: 15_000,
  retry: 0,
})

watch(data, (value) => {
  if (value) inventory.value = value
}, { immediate: true })

const filteredServices = computed(() => {
  return filterServices(inventory.value?.services ?? [], query.value, onlyWithGit.value)
})

const services = computed(() => {
  return sortServices(filteredServices.value, sortBy.value, sortOrder.value)
})

const endpointCount = computed(() =>
  inventory.value?.services.reduce((count, service) => count + service.endpoints.length, 0) ?? 0,
)
const serviceGroups = computed(() => groupServices(services.value, inventory.value?.homeDirectory))

const stale = computed(() =>
  inventory.value !== null && now.value - Date.parse(inventory.value.collectedAt) > 20_000,
)
const updatedAt = computed(() => inventory.value
  ? new Date(inventory.value.collectedAt).toLocaleTimeString('fr-FR')
  : null)
const stateLabel = computed(() => {
  if (error.value) return 'Actualisation interrompue'
  if (!inventory.value) return 'Collecte en cours'
  if (!automatic.value) return 'Actualisation en pause'
  if (stale.value) return 'Données anciennes'
  return 'À jour'
})

// Selection state & pruning
const selectedKeys = ref<Set<string>>(new Set())

watch(services, (visible) => {
  selectedKeys.value = pruneSelection(selectedKeys.value, visible)
}, { deep: true })

const eligibleVisibleServices = computed(() => services.value.filter(isStopEligible))
const allVisibleSelected = computed(() =>
  eligibleVisibleServices.value.length > 0
  && eligibleVisibleServices.value.every(s => selectedKeys.value.has(getServiceTargetKey(s)!)),
)
const someVisibleSelected = computed(() =>
  eligibleVisibleServices.value.some(s => selectedKeys.value.has(getServiceTargetKey(s)!)),
)

const selectedTargets = computed(() =>
  extractStopTargets(selectedKeys.value, services.value),
)

function isSelected(service: ObservedService): boolean {
  const key = getServiceTargetKey(service)
  return Boolean(key && selectedKeys.value.has(key))
}

function toggleServiceSelection(service: ObservedService) {
  if (!isStopEligible(service)) return
  const key = getServiceTargetKey(service)
  if (!key) return
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}

function toggleSelectAllVisible() {
  const next = new Set(selectedKeys.value)
  if (allVisibleSelected.value) {
    for (const service of eligibleVisibleServices.value) {
      const key = getServiceTargetKey(service)
      if (key) next.delete(key)
    }
  } else {
    for (const service of eligibleVisibleServices.value) {
      const key = getServiceTargetKey(service)
      if (key) next.add(key)
    }
  }
  selectedKeys.value = next
}

function clearSelection() {
  selectedKeys.value = new Set()
}

// Sorting logic
function toggleSort(field: SortField) {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortOrder.value = 'asc'
  }
}

function getSortButtonAriaLabel(field: SortField, label: string): string {
  if (sortBy.value === field) {
    const current = sortOrder.value === 'asc' ? 'croissant' : 'décroissant'
    const next = sortOrder.value === 'asc' ? 'décroissant' : 'croissant'
    return `Trier par ${label} (actuellement trié par ordre ${current}, cliquer pour trier par ordre ${next})`
  }
  return `Trier par ${label}`
}

const mobileSortValue = computed({
  get: () => `${sortBy.value}:${sortOrder.value}`,
  set: (val: string) => {
    const [field, order] = val.split(':') as [SortField, SortOrder]
    sortBy.value = field
    sortOrder.value = order
  },
})

const mobileSortOptions = [
  { label: 'Port (croissant)', value: 'port:asc' },
  { label: 'Port (décroissant)', value: 'port:desc' },
  { label: 'Nom (A → Z)', value: 'name:asc' },
  { label: 'Nom (Z → A)', value: 'name:desc' },
  { label: 'Durée (plus récente)', value: 'duration:asc' },
  { label: 'Durée (plus ancienne)', value: 'duration:desc' },
  { label: 'CPU (croissant)', value: 'cpu:asc' },
  { label: 'CPU (décroissant)', value: 'cpu:desc' },
  { label: 'RAM (croissant)', value: 'ram:asc' },
  { label: 'RAM (décroissant)', value: 'ram:desc' },
]

// Modal & stop actions
const isStopModalOpen = ref(false)
const isStopping = ref(false)
const forceStop = ref(false)
const includeSupervisors = ref(false)
const targetsToStop = ref<Array<ProcessStopTarget & {
  name: string
  ports: number[]
  supervisor?: ObservedService['stopSupervisor']
}>>([])
const stopResults = ref<StopResultItem[] | null>(null)
const modalError = ref<string | null>(null)
const openError = ref<string | null>(null)
const copiedBranch = ref<string | null>(null)
const copyFeedback = ref('')

const displayedModalTargets = computed(() => targetsToStop.value.slice(0, 100))
const hasSupervisors = computed(() => targetsToStop.value.some(target => target.supervisor))

const stopSummary = computed(() => {
  if (!stopResults.value?.length) return null
  let successCount = 0
  let failCount = 0
  for (const r of stopResults.value) {
    if (describeStopStatus(r.status).isExitOrSignal) successCount++
    else failCount++
  }
  return {
    total: stopResults.value.length,
    successCount,
    failCount,
  }
})

function openStopModal(targets: ProcessStopTarget[]) {
  if (!targets.length) return
  forceStop.value = false
  includeSupervisors.value = false
  modalError.value = null
  targetsToStop.value = targets.map((t) => {
    const matched = (inventory.value?.services ?? []).find(s => s.pid === t.pid && s.processStartId === t.processStartId)
    return {
      pid: t.pid,
      processStartId: t.processStartId,
      name: matched?.project?.name ?? matched?.processName ?? `PID ${t.pid}`,
      ports: matched?.endpoints.map(e => e.port) ?? [],
      supervisor: matched?.stopSupervisor,
    }
  })
  isStopModalOpen.value = true
}

function openStopModalForSingle(service: ObservedService) {
  if (!isStopEligible(service) || service.pid === null || !service.processStartId) return
  openStopModal([{ pid: service.pid, processStartId: service.processStartId }])
}

function closeStopModal() {
  if (isStopping.value) return
  isStopModalOpen.value = false
}

async function confirmStopProcesses() {
  if (isStopping.value || !targetsToStop.value.length || targetsToStop.value.length > 100) return
  isStopping.value = true
  modalError.value = null
  try {
    const payload = {
      targets: targetsToStop.value.map(t => ({
        pid: t.pid, processStartId: t.processStartId,
        supervisor: includeSupervisors.value ? t.supervisor : undefined,
      })),
      force: forceStop.value,
    }
    const response = await $fetch<{ results: StopResultItem[] }>('/api/processes/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portscope-Action': 'stop',
      },
      body: payload,
      retry: 0,
    })

    stopResults.value = response.results
    isStopModalOpen.value = false

    // Deselect exited or signaled targets, preserve failed ones and add failed single targets to selection for retry
    const nextSelection = new Set(selectedKeys.value)
    for (const res of response.results) {
      const desc = describeStopStatus(res.status)
      const key = `${res.pid}:${res.processStartId}`
      if (desc.isExitOrSignal) {
        nextSelection.delete(key)
      } else {
        nextSelection.add(key)
      }
    }
    selectedKeys.value = nextSelection

    // Refresh inventory to reflect updated state
    void refresh()
  } catch (err: any) {
    modalError.value = `Échec de la requête d’arrêt : ${err?.data?.message || err?.message || 'Erreur réseau ou service indisponible'}`
  } finally {
    isStopping.value = false
  }
}

// Open folder / editor
function canOpen(service: ObservedService): boolean {
  return Boolean(service.pid !== null && service.processStartId && (service.cwd || service.project?.root))
}

async function openProcess(service: ObservedService, destination: 'folder' | 'editor') {
  if (!canOpen(service) || service.pid === null || !service.processStartId) return
  openError.value = null
  try {
    await $fetch('/api/processes/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Portscope-Action': 'open',
      },
      body: {
        pid: service.pid,
        processStartId: service.processStartId,
        destination,
      },
      retry: 0,
    })
  } catch (err: any) {
    const destLabel = destination === 'editor' ? 'l’éditeur' : 'le dossier'
    openError.value = `Impossible d’ouvrir ${destLabel} : ${err?.data?.message || err?.message || 'erreur inconnue'}`
  }
}

// Copy branch
let copyTimeout: ReturnType<typeof setTimeout> | undefined
async function copyBranch(branch: string) {
  try {
    await navigator.clipboard.writeText(branch)
    copiedBranch.value = branch
    copyFeedback.value = `Nom de branche « ${branch} » copié dans le presse-papiers`
    clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => {
      copiedBranch.value = null
    }, 2000)
  } catch {
    copyFeedback.value = `Impossible de copier « ${branch} » dans le presse-papiers`
  }
}

// Helpers
function getStopDisabledTitle(service: ObservedService): string | undefined {
  const reason = getStopDisabledReason(service)
  if (reason === 'protected') return 'Processus protégé (Portscope ou système)'
  if (reason === 'identity-unavailable') return 'Identité du processus indisponible ou modifiée'
  return undefined
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return ''
  const date = new Date(startedAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('fr-FR')
}

function cpuSemanticTooltip(cpuPercent: number | null | undefined): string {
  if (cpuPercent === null || cpuPercent === undefined || typeof cpuPercent !== 'number' || Number.isNaN(cpuPercent)) {
    return 'Utilisation processeur : indisponible ou en attente du premier échantillon (100 % = 1 cœur CPU)'
  }
  return `Utilisation processeur : ${formatCpu(cpuPercent)} (100 % = 1 cœur CPU)`
}

// Polling and timers: 1s for clock/durations, 5s for inventory refresh
let secondInterval: ReturnType<typeof setInterval> | undefined
let refreshInterval: ReturnType<typeof setInterval> | undefined

const tickSecond = () => {
  now.value = Date.now()
}

const pollRefresh = () => {
  now.value = Date.now()
  if (automatic.value && !document.hidden && status.value !== 'pending') {
    void refresh()
  }
}

onMounted(() => {
  secondInterval = setInterval(tickSecond, 1_000)
  refreshInterval = setInterval(pollRefresh, 5_000)
  document.addEventListener('visibilitychange', pollRefresh)
})

onBeforeUnmount(() => {
  clearInterval(secondInterval)
  clearInterval(refreshInterval)
  clearTimeout(copyTimeout)
  document.removeEventListener('visibilitychange', pollRefresh)
})

watch(automatic, (enabled) => {
  if (enabled && status.value !== 'pending') void refresh()
})
</script>

<template>
  <UApp :locale="fr">
    <a class="skip-link" href="#inventory">Aller aux services</a>
    <header class="app-header">
      <div class="shell header-inner">
        <div class="app-heading">
          <span class="brand">
            <img src="/icons/icon-192.png" alt="" width="28" height="28" class="brand-icon">
            Portscope
          </span>
          <h1 id="page-title">Services locaux</h1>
        </div>
        <span class="machine-label">
          <UIcon name="i-lucide-monitor" aria-hidden="true" />
          Cette machine
          <span v-if="inventory" class="platform">{{ inventory.platform }}</span>
        </span>
      </div>
    </header>

    <main id="inventory" class="shell workspace" tabindex="-1" aria-labelledby="page-title">
      <div class="toolbar">
        <div class="search-field">
          <label for="service-search" class="sr-only">Rechercher un port, un projet, une branche ou un dossier</label>
          <UInput
            id="service-search"
            v-model="query"
            type="search"
            icon="i-lucide-search"
            placeholder="Port, projet, branche, dossier…"
            size="md"
            class="w-full"
            :ui="{ base: 'placeholder:text-muted' }"
            autocomplete="off"
          />
        </div>
        <div class="filter-controls">
          <UCheckbox
            v-model="onlyWithGit"
            label="Branches & worktrees uniquement"
            size="sm"
          />
          <div class="mobile-sort-wrapper">
            <label for="mobile-sort" class="sr-only">Trier la liste</label>
            <USelect
              id="mobile-sort"
              v-model="mobileSortValue"
              :items="mobileSortOptions"
              value-key="value"
              label-key="label"
              size="sm"
              icon="i-lucide-arrow-up-down"
              class="mobile-sort-select"
            />
          </div>
        </div>
        <div class="refresh-controls">
          <USwitch v-model="automatic" label="Actualisation auto" size="sm" />
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          >
            Actualiser
          </UButton>
        </div>
      </div>

      <div class="sr-only" role="status" aria-live="polite">
        {{ copyFeedback }}
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        title="La collecte n’a pas abouti"
        :description="inventory
          ? 'Les derniers résultats restent affichés. Réessayez avec Actualiser ; si le problème persiste, consultez les journaux de Portscope.'
          : 'Réessayez avec Actualiser. Si le problème persiste, vérifiez les outils de collecte et les journaux de Portscope.'"
        role="alert"
        class="notice"
      />
      <UAlert
        v-if="inventory?.warnings.length"
        color="warning"
        variant="soft"
        icon="i-lucide-info"
        title="Certaines informations sont indisponibles"
        class="notice"
      >
        <template #description>
          <ul class="warning-list">
            <li v-for="warning in inventory.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </template>
      </UAlert>

      <UAlert
        v-if="openError"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        title="Erreur d’ouverture"
        :description="openError"
        class="notice"
        role="alert"
        :close="{ onClick: () => openError = null }"
      />

      <UAlert
        v-if="stopResults"
        :color="stopSummary?.failCount ? 'warning' : 'success'"
        variant="soft"
        :icon="stopSummary?.failCount ? 'i-lucide-triangle-alert' : 'i-lucide-circle-check'"
        :title="`Résultats de l’arrêt · ${stopSummary?.successCount} sans erreur · ${stopSummary?.failCount} en échec`"
        class="notice"
        role="status"
        :close="{ onClick: () => stopResults = null }"
      >
        <template #description>
          <div class="stop-results-container">
            <ul class="stop-results-list" aria-label="Détail des résultats d’arrêt">
              <li v-for="res in stopResults" :key="`${res.pid}:${res.processStartId}`" class="stop-result-row">
                <span class="stop-result-target">PID {{ res.pid }}</span>
                <span class="stop-result-status" :class="`status-${describeStopStatus(res.status).severity}`">
                  {{ describeStopStatus(res.status).label }}
                </span>
                <span v-if="describeStopStatus(res.status).actionHint" class="stop-result-hint">
                  — {{ describeStopStatus(res.status).actionHint }}
                </span>
              </li>
            </ul>
            <p v-if="stopSummary?.failCount" class="stop-results-retry-note">
              Les processus en échec ont été conservés ou ajoutés à la sélection pour vous permettre de réessayer (par exemple en cochant « Forcer l’arrêt »).
            </p>
          </div>
        </template>
      </UAlert>

      <div v-if="selectedTargets.length > 0" class="selection-bar" role="region" aria-label="Sélection de processus">
        <div class="selection-info">
          <UIcon name="i-lucide-check-square" class="selection-icon" aria-hidden="true" />
          <span>
            <strong>{{ selectedTargets.length }}</strong>
            {{ selectedTargets.length === 1 ? 'processus sélectionné' : 'processus sélectionnés' }}
          </span>
          <span v-if="selectedTargets.length > 100" class="selection-limit-warning">
            (limite maximale de 100 processus pour un arrêt groupé)
          </span>
        </div>
        <div class="selection-actions">
          <UButton
            color="error"
            variant="solid"
            size="sm"
            icon="i-lucide-octagon-x"
            @click="openStopModal(selectedTargets)"
          >
            Arrêter la sélection
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            @click="clearSelection"
          >
            Désélectionner tout
          </UButton>
        </div>
      </div>

      <div class="inventory-summary">
        <p role="status" aria-live="polite">
          <template v-if="inventory">
            <strong>{{ services.length }}</strong>
            {{ services.length === 1 ? 'service' : 'services' }}
            <template v-if="query.trim() || onlyWithGit"> sur {{ inventory.services.length }}</template>
            <span v-else class="summary-detail"> · {{ endpointCount }} points d’écoute TCP</span>
          </template>
          <template v-else>Recherche des services en écoute…</template>
        </p>
        <div class="freshness">
          <span class="state" :class="{ 'state-warning': error || stale, 'state-paused': !automatic }">
            <span class="state-dot" aria-hidden="true" />
            {{ stateLabel }}
          </span>
          <span v-if="updatedAt" class="updated-at">
            <span class="sr-only">Dernière collecte </span>
            <time :datetime="inventory?.collectedAt">{{ updatedAt }}</time>
          </span>
        </div>
      </div>

      <div v-if="!inventory && status === 'pending'" class="empty-state" role="status">
        <UIcon name="i-lucide-radio" class="empty-icon" aria-hidden="true" />
        <h2>Lecture des ports en cours</h2>
        <p>Les services apparaîtront ici avec les informations disponibles.</p>
      </div>
      <div v-else-if="inventory && services.length === 0" class="empty-state">
        <UIcon :name="query.trim() ? 'i-lucide-search' : (onlyWithGit ? 'i-lucide-git-branch' : 'i-lucide-monitor')" class="empty-icon" aria-hidden="true" />
        <h2 v-if="query.trim()">Aucun service ne correspond</h2>
        <h2 v-else-if="onlyWithGit">Aucun service avec branche ou worktree détecté</h2>
        <h2 v-else>Aucun service en écoute détecté</h2>
        <p v-if="query.trim()">Essayez un autre port, nom de projet ou dossier.</p>
        <p v-else-if="onlyWithGit">Désactivez le filtre pour voir l’ensemble des services en écoute sur votre machine.</p>
        <p v-else>Les services visibles par votre utilisateur apparaîtront automatiquement ici.</p>
        <UButton v-if="query.trim()" color="neutral" variant="outline" @click="query = ''">
          Effacer la recherche
        </UButton>
        <UButton v-else-if="onlyWithGit" color="neutral" variant="outline" @click="onlyWithGit = false">
          Désactiver le filtre Git
        </UButton>
      </div>

      <template v-else-if="services.length">
        <div class="list-head service-grid">
          <div class="col-select">
            <UCheckbox
              :model-value="allVisibleSelected"
              :indeterminate="someVisibleSelected && !allVisibleSelected"
              :disabled="!eligibleVisibleServices.length"
              :aria-label="allVisibleSelected ? 'Désélectionner tous les processus visibles' : 'Sélectionner tous les processus visibles éligibles'"
              @update:model-value="toggleSelectAllVisible"
            />
          </div>
          <div class="col-header">
            <button
              type="button"
              class="sort-button"
              :aria-pressed="sortBy === 'port'"
              :aria-label="getSortButtonAriaLabel('port', 'port')"
              @click="toggleSort('port')"
            >
              <span>Port / adresse</span>
              <UIcon
                :name="sortBy === 'port' ? (sortOrder === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'"
                class="sort-icon"
                :class="{ 'sort-active': sortBy === 'port' }"
                aria-hidden="true"
              />
            </button>
          </div>
          <div class="col-header">
            <button
              type="button"
              class="sort-button"
              :aria-pressed="sortBy === 'name'"
              :aria-label="getSortButtonAriaLabel('name', 'projet ou processus')"
              @click="toggleSort('name')"
            >
              <span>Projet / processus</span>
              <UIcon
                :name="sortBy === 'name' ? (sortOrder === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'"
                class="sort-icon"
                :class="{ 'sort-active': sortBy === 'name' }"
                aria-hidden="true"
              />
            </button>
          </div>
          <div class="col-header">
            <button
              type="button"
              class="sort-button"
              title="Durée d’exécution depuis le démarrage"
              :aria-pressed="sortBy === 'duration'"
              :aria-label="getSortButtonAriaLabel('duration', 'durée d’exécution')"
              @click="toggleSort('duration')"
            >
              <span>Durée</span>
              <UIcon
                :name="sortBy === 'duration' ? (sortOrder === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'"
                class="sort-icon"
                :class="{ 'sort-active': sortBy === 'duration' }"
                aria-hidden="true"
              />
            </button>
          </div>
          <div class="col-header">
            <button
              type="button"
              class="sort-button"
              title="Utilisation processeur (100 % = 1 cœur CPU)"
              :aria-pressed="sortBy === 'cpu'"
              :aria-label="getSortButtonAriaLabel('cpu', 'CPU')"
              @click="toggleSort('cpu')"
            >
              <span>CPU</span>
              <UIcon
                :name="sortBy === 'cpu' ? (sortOrder === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'"
                class="sort-icon"
                :class="{ 'sort-active': sortBy === 'cpu' }"
                aria-hidden="true"
              />
            </button>
          </div>
          <div class="col-header">
            <button
              type="button"
              class="sort-button"
              title="Mémoire résidente (RSS)"
              :aria-pressed="sortBy === 'ram'"
              :aria-label="getSortButtonAriaLabel('ram', 'RAM')"
              @click="toggleSort('ram')"
            >
              <span>RAM</span>
              <UIcon
                :name="sortBy === 'ram' ? (sortOrder === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down') : 'i-lucide-arrow-up-down'"
                class="sort-icon"
                :class="{ 'sort-active': sortBy === 'ram' }"
                aria-hidden="true"
              />
            </button>
          </div>
          <div class="col-header">
            <span>Branche / worktree</span>
          </div>
          <div class="col-header">
            <span>Dossier du processus</span>
          </div>
          <div class="col-header col-action">
            <span class="sr-only">Actions</span>
          </div>
        </div>

        <ul class="service-list" aria-label="Services en écoute">
          <template v-for="group in serviceGroups" :key="group.id">
            <li
              v-for="(service, index) in group.services"
              :key="service.id"
              class="service-row service-grid"
              :class="{
                'group-member': index < group.services.length - 1,
                'group-continuation': index > 0,
                'row-selected': isSelected(service),
              }"
            >
              <div class="row-select">
                <UCheckbox
                  :model-value="isSelected(service)"
                  :disabled="!isStopEligible(service)"
                  :aria-label="getCheckboxAriaLabel(service)"
                  :title="getStopDisabledTitle(service)"
                  @update:model-value="toggleServiceSelection(service)"
                />
              </div>

              <ul class="endpoints" aria-label="Points d’écoute">
                <li v-for="endpoint in service.endpoints" :key="`${endpoint.family}:${endpoint.address}:${endpoint.port}`">
                  <UButton
                    v-if="endpoint.url"
                    :to="endpoint.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="soft"
                    size="sm"
                    trailing-icon="i-lucide-arrow-up-right"
                    :aria-label="`Ouvrir ${endpoint.url} dans un nouvel onglet`"
                    class="port-link"
                  >
                    {{ endpoint.port }}
                  </UButton>
                  <template v-else>
                    <span class="port-number">{{ endpoint.port }}</span>
                    <UButton
                      v-if="httpAttemptUrl(endpoint)"
                      :to="httpAttemptUrl(endpoint)"
                      target="_blank"
                      rel="noopener noreferrer"
                      color="neutral"
                      variant="link"
                      size="xs"
                      trailing-icon="i-lucide-arrow-up-right"
                      :aria-label="`Essayer ${httpAttemptUrl(endpoint)} dans un nouvel onglet ; protocole non identifié`"
                      class="http-attempt"
                    >
                      Essayer HTTP
                    </UButton>
                    <span v-else class="unknown">Adresse non prise en charge par le navigateur</span>
                  </template>
                  <span class="endpoint-address">
                    {{ endpoint.address }}
                    <span v-if="!endpoint.url" class="protocol-label">TCP</span>
                  </span>
                </li>
              </ul>

              <div class="service-name">
                <h2>{{ service.project?.name ?? service.processName ?? 'Processus non identifié' }}</h2>
                <span class="process-detail">
                  {{ service.processName ?? 'Nom indisponible' }}
                  <span v-if="service.pid !== null"> · PID {{ service.pid }}</span>
                </span>
              </div>

              <div class="service-duration">
                <span
                  class="duration-value"
                  :title="service.startedAt ? `Démarré à ${formatStartedAt(service.startedAt)}` : 'Heure de démarrage indisponible'"
                >
                  {{ formatDuration(service.startedAt, now) }}
                </span>
              </div>

              <div class="service-metric metric-cpu" :title="cpuSemanticTooltip(service.metrics?.cpuPercent)">
                <span class="metric-label">CPU </span>{{ formatCpu(service.metrics?.cpuPercent) }}
              </div>
              <div class="service-metric metric-ram" title="Mémoire résidente (RSS)">
                <span class="metric-label">RAM </span>{{ formatBytes(service.metrics?.rssBytes) }}
              </div>

              <div class="git-context">
                <template v-if="service.project">
                  <div class="branch-line">
                    <a
                      v-if="service.project.branchUrl"
                      :href="service.project.branchUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="branch-name branch-link"
                      :aria-label="`Ouvrir la branche distante associée à ${service.project.branch ?? service.project.name} dans un nouvel onglet`"
                    >
                      <UIcon name="i-lucide-git-branch" aria-hidden="true" />
                      {{ service.project.branch ?? 'Branche distante' }}
                      <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" />
                    </a>
                    <span v-else class="branch-name">
                      <UIcon name="i-lucide-git-branch" aria-hidden="true" />
                      {{ service.project.branch ?? 'Branche non identifiée' }}
                    </span>
                    <UButton
                      v-if="service.project.branch"
                      :icon="copiedBranch === service.project.branch ? 'i-lucide-check' : 'i-lucide-copy'"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      class="copy-branch-btn"
                      :aria-label="`Copier le nom de la branche ${service.project.branch}`"
                      :title="`Copier « ${service.project.branch} »`"
                      @click.stop.prevent="copyBranch(service.project.branch)"
                    />
                  </div>
                  <button
                    v-if="service.project.worktree"
                    type="button"
                    class="worktree-link-btn"
                    :disabled="!canOpen(service)"
                    :title="canOpen(service) ? 'Ouvrir la racine du worktree / projet dans le gestionnaire de fichiers' : 'Ouverture indisponible'"
                    @click="openProcess(service, 'folder')"
                  >
                    <span class="sr-only">Worktree : </span>{{ service.project.worktree }}
                  </button>
                </template>
                <span v-else class="unknown">Contexte Git non identifié</span>
              </div>

              <div v-if="index === 0" class="directory">
                <div class="directory-actions">
                  <button
                    v-if="service.cwd"
                    type="button"
                    class="directory-link-btn"
                    :disabled="!canOpen(service)"
                    :title="canOpen(service) ? 'Ouvrir ce dossier dans le gestionnaire de fichiers' : 'Ouverture indisponible'"
                    @click="openProcess(service, 'folder')"
                  >
                    <code>{{ service.cwd }}</code>
                  </button>
                  <span v-else class="unknown">Dossier indisponible</span>
                  <UButton
                    v-if="canOpen(service)"
                    icon="i-lucide-code"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    class="open-editor-btn"
                    :aria-label="`Ouvrir le projet de ${service.project?.name ?? service.processName ?? 'ce processus'} dans VS Code`"
                    title="Ouvrir dans VS Code"
                    @click="openProcess(service, 'editor')"
                  />
                </div>
                <span v-if="group.services.length > 1" class="process-detail">
                  {{ group.services.length }} processus
                </span>
              </div>
              <div v-else class="directory-placeholder" aria-hidden="true" />

              <div class="row-actions">
                <UButton
                  color="error"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-circle-stop"
                  :disabled="!isStopEligible(service)"
                  :title="getStopDisabledTitle(service) || 'Arrêter ce processus'"
                  :aria-label="`Arrêter le processus ${service.processName ?? service.pid}`"
                  @click="openStopModalForSingle(service)"
                >
                  Arrêter
                </UButton>
              </div>
            </li>
          </template>
        </ul>
      </template>

      <!-- Confirmation Modal -->
      <UModal
        v-model:open="isStopModalOpen"
        :title="targetsToStop.length === 1 ? 'Confirmer l’arrêt du processus' : `Confirmer l’arrêt de ${targetsToStop.length} processus`"
        :description="targetsToStop.length === 1 ? 'Une demande d’interruption va être envoyée à ce processus.' : 'Une demande d’interruption va être envoyée à l’ensemble des cibles sélectionnées.'"
        :dismissible="!isStopping"
      >
        <template #body>
          <UAlert
            v-if="modalError"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            title="Échec de la demande d’arrêt"
            :description="modalError"
            class="mb-3"
          />

          <UAlert
            v-if="targetsToStop.length > 100"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            title="Limite de 100 processus dépassée"
            :description="`Portscope limite chaque demande d’arrêt à 100 processus simultanés (votre sélection en compte actuellement ${targetsToStop.length}). Veuillez réduire la sélection pour pouvoir continuer.`"
            class="mb-3"
          />

          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="Perte potentielle de données"
            description="L’arrêt peut entraîner la perte des modifications non enregistrées."
            class="mb-3"
          />

          <div class="modal-targets">
            <p class="modal-targets-heading">
              {{ targetsToStop.length === 1 ? 'Processus cible :' : `Processus cibles (${targetsToStop.length}) :` }}
            </p>
            <ul class="modal-targets-list" aria-label="Liste des processus à arrêter">
              <li
                v-for="target in displayedModalTargets"
                :key="`${target.pid}:${target.processStartId}`"
                class="modal-target-item"
              >
                <span class="target-name">{{ target.name }}</span>
                <span class="target-meta">
                  PID {{ target.pid }}
                  <template v-if="target.ports.length"> · Port{{ target.ports.length > 1 ? 's' : '' }} {{ target.ports.join(', ') }}</template>
                  <template v-if="target.supervisor"> · Parent Node : PID {{ target.supervisor.pid }}</template>
                </span>
              </li>
            </ul>
            <p v-if="targetsToStop.length > 100" class="modal-overflow-note">
              + {{ targetsToStop.length - 100 }} autres processus…
            </p>
          </div>

          <div class="modal-force-option space-y-3">
            <UCheckbox
              v-if="hasSupervisors"
              v-model="includeSupervisors"
              :disabled="isStopping"
              label="Arrêter aussi les parents Node indiqués"
              description="Utile si un outil de développement surveille les fichiers ou relance le service. Sans cette option, seul le processus qui écoute est visé."
            />
            <UCheckbox
              v-model="forceStop"
              :disabled="isStopping"
              label="Forcer l’arrêt immédiat (SIGKILL)"
              description="Arrête les processus visés sans leur laisser le temps de se fermer proprement. À utiliser si l’arrêt normal ne fonctionne pas ou n’est pas disponible."
            />
          </div>
        </template>

        <template #footer>
          <div class="modal-actions">
            <UButton
              color="neutral"
              variant="outline"
              :disabled="isStopping"
              @click="closeStopModal"
            >
              Annuler
            </UButton>
            <UButton
              color="error"
              :loading="isStopping"
              :disabled="isStopping || targetsToStop.length > 100"
              @click="confirmStopProcesses"
            >
              <template v-if="forceStop">Forcer l’arrêt</template>
              <template v-else>
                Arrêter
                <template v-if="targetsToStop.length === 1"> le processus</template>
                <template v-else> les {{ targetsToStop.length }} processus</template>
              </template>
            </UButton>
          </div>
        </template>
      </UModal>

      <footer class="workspace-footer">
        <span>Un port ouvert ne signifie pas qu’un service est une application web.</span>
        <span>Gestion des processus · {{ automatic ? 'Collecte toutes les 5 s, onglet visible' : 'Actualisation automatique en pause' }}</span>
      </footer>
    </main>
  </UApp>
</template>
