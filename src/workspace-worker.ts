import {planFile} from "./merge-plan";
self.onmessage = event => self.postMessage(planFile(event.data));
