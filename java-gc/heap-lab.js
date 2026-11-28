(() => {
  const youngCapacity = 8;
  const oldCapacity = 4;
  const promotionAge = 2;
  const objectTypes = ["Response", "Payload"];
  const lab = document.querySelector("#heap-lab");
  const youngSlots = lab.querySelector("#young-slots");
  const oldSlots = lab.querySelector("#old-slots");
  const heapUsed = lab.querySelector("#heap-used");
  const requestCount = lab.querySelector("#request-count");
  const reclaimedCount = lab.querySelector("#reclaimed-count");
  const status = lab.querySelector("#lab-status");

  let young;
  let old;
  let activeRequests;
  let retainedPayloads;
  let nextRequest;
  let reclaimed;

  function requestObjects(request) {
    return objectTypes.map(type => ({ type, request, age: 0 }));
  }

  function isReachable(object) {
    return object.request === undefined ||
      activeRequests.has(object.request) ||
      retainedPayloads.has(object);
  }

  function renderGeneration(list, objects, capacity) {
    const slots = Array.from({ length: capacity }, (_, index) => {
      const slot = document.createElement("li");
      slot.className = "slot";
      const object = objects[index];
      if (!object) {
        slot.textContent = "Free";
        return slot;
      }

      const name = document.createElement("span");
      name.className = "slot-name";
      name.textContent = object.type;
      if (object.request !== undefined) {
        name.textContent += ` #${object.request}`;
      }

      const state = document.createElement("span");
      state.className = "slot-state";
      const reachable = isReachable(object);
      slot.dataset.state = reachable ? "live" : "dead";
      state.textContent = reachable ? "Reachable" : "Unreachable";
      if (retainedPayloads.has(object)) {
        state.textContent += " · Cached";
      }
      slot.append(name, state);
      return slot;
    });
    list.replaceChildren(...slots);
  }

  function render(message) {
    renderGeneration(youngSlots, young, youngCapacity);
    renderGeneration(oldSlots, old, oldCapacity);
    heapUsed.textContent = `${young.length + old.length} / ${youngCapacity + oldCapacity}`;
    requestCount.textContent = activeRequests.size;
    reclaimedCount.textContent = reclaimed;
    status.textContent = message;
  }

  function reset() {
    young = [...requestObjects(1), ...requestObjects(2)];
    old = [{ type: "Cache" }, { type: "App config" }];
    activeRequests = new Set([2]);
    retainedPayloads = new Set();
    nextRequest = 3;
    reclaimed = 0;
    render("Request 1 has finished. Request 2 is still active.");
  }

  function collectYoung() {
    let freed = 0;
    let promoted = 0;
    const survivors = [];
    for (const object of young) {
      if (!isReachable(object)) {
        freed++;
        continue;
      }

      object.age++;
      if (object.age >= promotionAge && old.length < oldCapacity) {
        old.push(object);
        promoted++;
      } else {
        survivors.push(object);
      }
    }
    young = survivors;
    reclaimed += freed;
    render(`Young collection reclaimed ${freed} and promoted ${promoted}. ${young.length} remain in young.`);
  }

  function sendRequests() {
    const first = nextRequest;
    const second = first + 1;
    const newObjects = [...requestObjects(first), ...requestObjects(second)];
    if (young.length + newObjects.length > youngCapacity) {
      render("The burst needs four free young slots. Try finishing requests or clearing cache entries, then collect young.");
      return;
    }

    young.push(...newObjects);
    activeRequests.add(first);
    activeRequests.add(second);
    nextRequest = second + 1;
    render(`Requests ${first} and ${second} allocated four young objects.`);
  }

  function finishRequests() {
    if (activeRequests.size === 0) {
      render("There are no active requests. Send more requests to add objects.");
      return;
    }

    activeRequests.clear();
    render("All requests finished. Payloads held by the cache stay reachable.");
  }

  function retainPayload() {
    const payload = [...young, ...old].find(object =>
      object.type === "Payload" &&
      activeRequests.has(object.request) &&
      !retainedPayloads.has(object)
    );
    if (!payload) {
      render("Every active request payload is already cached, or there are no active requests.");
      return;
    }

    retainedPayloads.add(payload);
    render(`The cache now holds payload #${payload.request} and will keep it reachable after the request finishes.`);
  }

  function clearCache() {
    if (retainedPayloads.size === 0) {
      render("The cache has no retained payloads.");
      return;
    }

    retainedPayloads.clear();
    render("Cache entries cleared. Payloads from finished requests are now unreachable.");
  }

  lab.querySelector("#reset-lab").addEventListener("click", reset);
  lab.querySelector("#collect-young").addEventListener("click", collectYoung);
  lab.querySelector("#send-requests").addEventListener("click", sendRequests);
  lab.querySelector("#finish-requests").addEventListener("click", finishRequests);
  lab.querySelector("#retain-payload").addEventListener("click", retainPayload);
  lab.querySelector("#clear-cache").addEventListener("click", clearCache);
  reset();
  lab.hidden = false;
})();
