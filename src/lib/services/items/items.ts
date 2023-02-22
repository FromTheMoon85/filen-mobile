import { apiRequest, fetchOfflineFilesInfo, folderPresent } from "../../api"
import storage from "../../storage"
import { getAPIKey, orderItemsByType, getFilePreviewType, getFileExt, getParent, getRouteURL, canCompressThumbnail, simpleDate, convertTimestampToMs } from "../../helpers"
import striptags from "striptags"
import { getDownloadPath, queueFileDownload } from "../download/download"
import * as fs from "../../fs"
import { DeviceEventEmitter } from "react-native"
import { useStore } from "../../state"
import FileViewer from "react-native-file-viewer"
import { getOfflineList, removeFromOfflineStorage, changeItemNameInOfflineList, getItemOfflinePath } from "../offline"
import { showToast } from "../../../components/Toasts"
import { i18n } from "../../../i18n/i18n"
import { StackActions } from "@react-navigation/native"
import { navigationAnimation } from "../../state"
import memoryCache from "../../memoryCache"
import { isOnline, isWifi } from "../isOnline"
import { Item, BuildFolder, ItemReceiver } from "../../../types"
import { MB } from "../../constants"
import { memoize } from "lodash"
import { getAssetId } from "../../helpers"
import { Asset } from "expo-media-library"
import { getLocalAssetsMutex, getAssetURI } from "../cameraUpload"
import { getThumbnailCacheKey } from "../thumbnails"
import { decryptFolderNamePrivateKey, decryptFileMetadataPrivateKey, decryptFolderName, decryptFileMetadata } from "../../crypto"
import { PreviewItem } from "../../../screens/ImageViewerScreen"

export const buildFolder = async ({ folder, name = "", masterKeys = [], sharedIn = false, privateKey = "", routeURL, userId = 0, loadFolderSizes = false }: BuildFolder): Promise<Item> => {
    const cacheKey = "itemMetadata:folder:" + folder.uuid + ":" + folder.name + ":" + sharedIn.toString()

    if(memoryCache.has(cacheKey)){
        name = memoryCache.get(cacheKey)
    }
    else{
        if(!sharedIn){
            if(typeof masterKeys !== "undefined" && typeof folder.name !== "undefined"){
                name = await decryptFolderName(masterKeys, folder.name, folder.uuid)
                
                memoryCache.set(cacheKey, name)
            }
        }
        else{
            if(typeof privateKey !== "undefined" && typeof folder.metadata !== "undefined"){
                name = await decryptFolderNamePrivateKey(privateKey, folder.metadata, folder.uuid)
                
                memoryCache.set(cacheKey, name)
            }
        }
    }

    const folderLastModified = convertTimestampToMs(folder.timestamp)

    return {
        id: folder.uuid,
        type: "folder",
        uuid: folder.uuid,
        name: striptags(name),
        date: simpleDate(folderLastModified),
        timestamp: folder.timestamp,
        lastModified: folderLastModified,
        lastModifiedSort: parseFloat(folderLastModified + "." + folder.uuid.replace(/\D/g, "")),
        parent: folder.parent || "base",
        receiverId: typeof folder.receiverId == "number" ? folder.receiverId : 0,
        receiverEmail: typeof folder.receiverEmail == "string" ? folder.receiverEmail : "",
        sharerId: typeof folder.sharerId == "number" ? folder.sharerId : 0,
        sharerEmail: typeof folder.sharerEmail == "string" ? folder.sharerEmail : "",
        color: folder.color || null,
        favorited: folder.favorited == 1 ? true : false,
        isBase: typeof folder.parent == "string" ? false : true,
        isSync: folder.is_sync || false,
        isDefault: folder.is_default || false,
        size: storage.getNumber("folderSizeCache:" + folder.uuid),
        selected: false,
        mime: "",
        key: "",
        offline: false,
        bucket: "",
        region: "",
        rm: "",
        chunks: 0,
        thumbnail: undefined,
        version: 0,
        hash: ""
    }
}

export interface BuildFile {
    file: any,
    metadata?: {
        name: string,
        mime: string,
        size: number,
        key: string,
        lastModified: number,
        hash: string
    },
    masterKeys?: string[],
    sharedIn?: boolean,
    privateKey?: string,
    routeURL?: string,
    userId?: number
}

export const buildFile = async ({ file, metadata = { name: "", mime: "", size: 0, key: "", lastModified: 0, hash: "" }, masterKeys = [], sharedIn = false, privateKey = "", routeURL = "", userId = 0 }: BuildFile): Promise<Item> => {
    const cacheKey = "itemMetadata:file:" + file.uuid + ":" + file.metadata + ":" + sharedIn.toString()

    if(memoryCache.has(cacheKey)){
        metadata = memoryCache.get(cacheKey)
    }
    else{
        if(!sharedIn){
            if(typeof masterKeys !== "undefined" && typeof file.metadata !== "undefined"){
                metadata = await decryptFileMetadata(masterKeys, file.metadata, file.uuid)

                memoryCache.set(cacheKey, metadata)
            }
        }
        else{
            if(typeof privateKey !== "undefined" && typeof file.metadata !== "undefined"){
                metadata = await decryptFileMetadataPrivateKey(file.metadata, privateKey, file.uuid)
                
                memoryCache.set(cacheKey, metadata)
            }
        }
    }

    let thumbnailCachePath = undefined

    if(canCompressThumbnail(getFileExt(metadata.name))){
        const thumbnailCacheKey = getThumbnailCacheKey({ uuid: file.uuid }).cacheKey

        if(memoryCache.has(thumbnailCacheKey)){
            thumbnailCachePath = memoryCache.get(thumbnailCacheKey)
        }
        else{
            const thumbnailCache = storage.getString(thumbnailCacheKey)
    
            if(typeof thumbnailCache == "string"){
                if(thumbnailCache.length > 0){
                    thumbnailCachePath = thumbnailCache
                    
                    memoryCache.set(thumbnailCacheKey, thumbnailCache)
                }
            }
        }
    }

    const fileLastModified = typeof metadata.lastModified == "number" && !isNaN(metadata.lastModified) && metadata.lastModified > 1348846653  ? convertTimestampToMs(metadata.lastModified) : convertTimestampToMs(file.timestamp)

    return {
        id: file.uuid,
        type: "file",
        uuid: file.uuid,
        name: striptags(metadata.name),
        mime: metadata.mime,
        size: typeof file.size == "number" ? file.size : typeof file.chunks_size == "number" ? file.chunks_size : 0,
        key: metadata.key,
        lastModified: fileLastModified,
        lastModifiedSort: parseFloat(fileLastModified + "." + file.uuid.replace(/\D/g, "")),
        bucket: file.bucket,
        region: file.region,
        parent: file.parent || "base",
        rm: file.rm,
        chunks: file.chunks,
        date: simpleDate(fileLastModified),
        timestamp: file.timestamp,
        receiverId: typeof file.receiverId == "number" ? file.receiverId : 0,
        receiverEmail: typeof file.receiverEmail == "string" ? file.receiverEmail : undefined,
        sharerId: typeof file.sharerId == "number" ? file.sharerId : 0,
        sharerEmail: typeof file.sharerEmail == "string" ? file.sharerEmail : undefined,
        offline: typeof userId == "number" && userId !== 0 ? (storage.getBoolean(userId + ":offlineItems:" + file.uuid) ? true : false) : false,
        version: file.version,
        favorited: file.favorited,
        thumbnail: thumbnailCachePath,
        selected: false,
        color: null,
        isBase: false,
        isSync: false,
        isDefault: false,
        hash: typeof metadata.hash == "string" && metadata.hash.length > 0 ? metadata.hash : ""
    }
}

export const sortItems = memoize(({ items, passedRoute = undefined }: { items: Item[], passedRoute: any }): Item[] => {
    let routeURL = ""

    if(typeof passedRoute !== "undefined"){
        routeURL = getRouteURL(passedRoute)
    }
    else{
        routeURL = getRouteURL()
    }

    if(routeURL.indexOf("photos") !== -1){
        return items.sort((a, b) => b.lastModifiedSort - a.lastModifiedSort)
    }

    const routeEx = routeURL.split("/")

    if(routeEx[routeEx.length - 1] == storage.getString("cameraUploadFolderUUID:" + storage.getNumber("userId"))){
        const folders = items.filter(item => item.type == "folder")
        const files = items.filter(item => item.type == "file")

        return [...folders, ...files.sort((a, b) => {
            return b.lastModifiedSort - a.lastModifiedSort
        })]
    }

    const sortBy = JSON.parse(storage.getString("sortBy") || "{}")

    if(routeURL.indexOf("recents") !== -1){
        items = items
    }
    else{
        items = orderItemsByType(items, sortBy[routeURL])
    }

    return items
}, ({ items, passedRoute = undefined }: { items: Item[], passedRoute: any }) => JSON.stringify(items) + ":" + JSON.stringify(passedRoute))

export interface LoadItems {
    parent: string,
    prevItems: Item[],
    setItems: React.Dispatch<React.SetStateAction<Item[]>>,
    masterKeys: string[],
    setLoadDone: React.Dispatch<React.SetStateAction<boolean>>,
    bypassCache?: boolean,
    isFollowUpRequest?: boolean,
    callStack?: number,
    navigation?: any,
    isMounted: () => boolean,
    route?: any,
    setProgress?: any,
    loadFolderSizes?: boolean
}

export const loadItems = async ({ parent, prevItems, setItems, masterKeys, setLoadDone, bypassCache = false, isFollowUpRequest = false, callStack = 0, navigation, isMounted, route, setProgress, loadFolderSizes = false }: LoadItems): Promise<boolean> => {
    const userId = storage.getNumber("userId")

    if(typeof userId !== "number"){
        console.error("userId in storage !== number")

        return false
    }

    if(userId == 0){
        console.error("userId in storage invalid (0)")

        return false
    }
    
    let items: Item[] = []
    let isDeviceOnline = isOnline()
    const routeURL = typeof route !== "undefined" ? getRouteURL(route) : getRouteURL()
    const cacheKey = "loadItemsCache:" + routeURL
    const cacheKeyLastResponse = "loadItemsCache:lastResponse:" + routeURL

    try{
        var cacheRaw = storage.getString(cacheKey)
        var cache = typeof cacheRaw == "string" ? JSON.parse(cacheRaw) : undefined
    }
    catch(e){
        console.error(e)

        var cache = undefined
        
        bypassCache = true
    }

    if(!isDeviceOnline){
		bypassCache = false
	}

    if(typeof cache == "object" && !bypassCache){
        if(callStack == 0 && isDeviceOnline && !isFollowUpRequest){
            //setLoadDone(true)

			loadItems({
                parent,
                setItems,
                prevItems,
                masterKeys,
                setLoadDone,
                bypassCache: true,
                isFollowUpRequest: true,
                callStack: 1,
                navigation,
                isMounted,
                route,
                setProgress
            })
		}

        items = cache

        if(getParent(route) == parent && isMounted()){
            items = sortItems({ items, passedRoute: route })

            setItems(items.filter(item => item !== null && typeof item.uuid == "string"))
            setLoadDone(true)
        }

        return true
    }

    if(parent == "base"){
        try{
            var response = await apiRequest({
                method: "POST",
                endpoint: "/v1/user/baseFolders",
                data: {
                    apiKey: getAPIKey()
                }
            })
        }
        catch(e){
            console.log(e)

            return false
        }

        if(!response.status){
            console.log(response.message)

            return false
        }

        /*if(typeof cache !== "undefined"){
            if(cache.length > 0){
                try{
                    const responseString = JSON.stringify(response.data)

                    if(storage.getString(cacheKeyLastResponse) == responseString){
                        return false
                    }

                    storage.set(cacheKeyLastResponse, responseString)
                }
                catch(e){
                    console.log(e)
                }
            }
        }*/

        for(let i = 0; i < response.data.folders.length; i++){
			let folder = response.data.folders[i]

			let item = await buildFolder({ folder, masterKeys, userId, routeURL, loadFolderSizes })

			items.push(item)

			storage.set("itemCache:folder:" + folder.uuid, JSON.stringify(item))
		}
    }
    else if(parent == "recents"){
        try{
            var response = await apiRequest({
                method: "POST",
                endpoint: "/v1/user/recent",
                data: {
                    apiKey: getAPIKey()
                }
            })
        }
        catch(e){
            console.log(e)

            return false
        }

        if(!response.status){
            console.log(response.message)

            return false
        }

        /*if(typeof cache !== "undefined"){
            if(cache.length > 0){
                try{
                    const responseString = JSON.stringify(response.data)

                    if(storage.getString(cacheKeyLastResponse) == responseString){
                        return false
                    }

                    storage.set(cacheKeyLastResponse, responseString)
                }
                catch(e){
                    console.log(e)
                }
            }
        }*/

        for(let i = 0; i < response.data.length; i++){
            let file = response.data[i]
            
            let item = await buildFile({ file, masterKeys, userId })

            items.push(item)

			storage.set("itemCache:file:" + file.uuid, JSON.stringify(item))
        }
    }
    else if(routeURL.indexOf("shared-in") !== -1){
        try{
            var response = await apiRequest({
                method: "POST",
                endpoint: "/v1/user/shared/in",
                data: {
                    apiKey: getAPIKey(),
                    uuid: parent,
                    folders: JSON.stringify(["shared-in"]),
                    page: 1,
                    app: "true"
                }
            })
        }
        catch(e){
            console.log(e)

            return false
        }

        if(!response.status){
            console.log(response.message)

            return false
        }

        /*if(typeof cache !== "undefined"){
            if(cache.length > 0){
                try{
                    const responseString = JSON.stringify(response.data)

                    if(storage.getString(cacheKeyLastResponse) == responseString){
                        return false
                    }

                    storage.set(cacheKeyLastResponse, responseString)
                }
                catch(e){
                    console.log(e)
                }
            }
        }*/

        const privateKey = storage.getString("privateKey")

        for(let i = 0; i < response.data.folders.length; i++){
			let folder = response.data.folders[i]
			
            let item = await buildFolder({ folder, masterKeys, sharedIn: true, privateKey, userId, routeURL, loadFolderSizes })

			items.push(item)

			storage.set("itemCache:folder:" + folder.uuid, JSON.stringify(item))
		}

        for(let i = 0; i < response.data.uploads.length; i++){
            let file = response.data.uploads[i]

            let item = await buildFile({ file, masterKeys, sharedIn: true, privateKey, userId })

            items.push(item)

			storage.set("itemCache:file:" + file.uuid, JSON.stringify(item))
        }
    }
    else if(routeURL.indexOf("shared-out") !== -1){
        try{
            var response = await apiRequest({
                method: "POST",
                endpoint: "/v1/user/shared/out",
                data: {
                    apiKey: getAPIKey(),
                    uuid: parent,
                    folders: JSON.stringify(["default"]),
                    page: 1,
                    app: "true",
                    receiverId: global.currentReceiverId
                }
            })
        }
        catch(e){
            console.log(e)

            return false
        }

        if(!response.status){
            console.log(response.message)

            return false
        }

        /*if(typeof cache !== "undefined"){
            if(cache.length > 0){
                try{
                    const responseString = JSON.stringify(response.data)

                    if(storage.getString(cacheKeyLastResponse) == responseString){
                        return false
                    }

                    storage.set(cacheKeyLastResponse, responseString)
                }
                catch(e){
                    console.log(e)
                }
            }
        }*/

        for(let i = 0; i < response.data.folders.length; i++){
			let folder = response.data.folders[i]

            folder.name = folder.metadata
			
            let item = await buildFolder({ folder, masterKeys, userId, routeURL, loadFolderSizes })

			items.push(item)

			storage.set("itemCache:folder:" + folder.uuid, JSON.stringify(item))
		}

        for(let i = 0; i < response.data.uploads.length; i++){
            let file = response.data.uploads[i]

            let item = await buildFile({ file, masterKeys, userId })

            items.push(item)

			storage.set("itemCache:file:" + file.uuid, JSON.stringify(item))
        }

        const groups: Item[] = []
        const sharedTo: { [key: string]: ItemReceiver[] } = {}
        const added: { [key: string]: boolean } = {}

        for(let i = 0; i < items.length; i++){
            if(Array.isArray(sharedTo[items[i].uuid])){
                sharedTo[items[i].uuid].push({
                    id: items[i].receiverId,
                    email: items[i].receiverEmail
                })
            }
            else{
                sharedTo[items[i].uuid] = [{
                    id: items[i].receiverId,
                    email: items[i].receiverEmail
                }]
            }
        }

        for(let i = 0; i < items.length; i++){
            if(Array.isArray(sharedTo[items[i].uuid])){
                items[i].receivers = sharedTo[items[i].uuid]
            }

            if(!added[items[i].uuid]){
                added[items[i].uuid] = true

                groups.push(items[i])
            }
        }

        items = groups
    }
    else if(parent == "photos"){
        try{
            var cameraUploadParent = storage.getString("cameraUploadFolderUUID:" + userId)
        }
        catch(e){
            console.log(e)
        }

        if(typeof cameraUploadParent == "string"){
            if(cameraUploadParent.length > 16){
                try{
                    let folderExists: boolean = false

                    const isFolderPresent = await folderPresent({ uuid: cameraUploadParent })

                    if(isFolderPresent.present){
                        if(!isFolderPresent.trash){
                            folderExists = true
                        }
                    }

                    if(!folderExists){
                        setItems([])
                        setLoadDone(true)

                        return true
                    }

                    var response = await apiRequest({
                        method: "POST",
                        endpoint: "/v1/dir/content",
                        data: {
                            apiKey: getAPIKey(),
                            uuid: cameraUploadParent,
                            folders: JSON.stringify(["default"]),
                            page: 1,
                            app: "true"
                        }
                    })
                }
                catch(e){
                    console.log(e)
        
                    return false
                }
        
                if(!response.status){
                    console.log(response.message)
        
                    return false
                }

                if(typeof cache !== "undefined"){
                    if(cache.length > 0){
                        try{
                            const responseString = JSON.stringify(response.data)
        
                            if(storage.getString(cacheKeyLastResponse) == responseString){
                                return false
                            }
            
                            storage.set(cacheKeyLastResponse, responseString)
                        }
                        catch(e){
                            console.log(e)
                        }
                    }
                }
        
                for(let i = 0; i < response.data.uploads.length; i++){
                    let file = response.data.uploads[i]
        
                    let item = await buildFile({ file, masterKeys, userId })
        
                    if(canCompressThumbnail(getFileExt(item.name))){
                        items.push(item)
                    }
        
                    storage.set("itemCache:file:" + file.uuid, JSON.stringify(item))
                }
            }
        }
    }
    else if(parent == "offline"){
        try{
            var [ list, offlinePath ] = await Promise.all([
                getOfflineList(),
                getDownloadPath({ type: "offline" })
            ])
        }
        catch(e){
            console.log(e)

            return false
        }

        for(let i = 0; i < list.length; i++){
            let file = list[i]

            file.offline = true

            const itemOfflinePath = getItemOfflinePath(offlinePath, file)

            try{
                if(!(await fs.stat(itemOfflinePath)).exists){
                    await removeFromOfflineStorage({ item: file })

                    if(isOnline()){
                        queueFileDownload({
                            file,
                            storeOffline: true
                        }).catch(console.error)
                    }
                }
                else{
                    items.push(file)
                }
            }
            catch(e){
                console.log(e)

                items.push(file)
            }
        }

        const offlineFilesToFetchInfo = items.map(item => item.uuid)

        if(offlineFilesToFetchInfo.length > 0 && isOnline()){
            try{
                var offlineFilesInfo = await fetchOfflineFilesInfo({ files: offlineFilesToFetchInfo })
            }
            catch(e){
                console.log(e)
    
                return false
            }
    
            for(let i = 0; i < items.length; i++){
                const prop = items[i].uuid
                const itemUUID = items[i].uuid
                const itemName = items[i].name

                if(typeof offlineFilesInfo[prop] !== "undefined"){
                    if(offlineFilesInfo[prop].exists){
                        items[i].favorited = offlineFilesInfo[prop].favorited

                        try{
                            if(offlineFilesInfo[prop].isVersioned){
                                var metadata = await decryptFileMetadata(masterKeys, offlineFilesInfo[prop].versionedInfo.metadata, offlineFilesInfo[prop].versionedInfo.uuid)
                            }
                            else{
                                var metadata = await decryptFileMetadata(masterKeys, offlineFilesInfo[prop].metadata, prop)
                            }

                            if(typeof metadata == "object"){
                                if(offlineFilesInfo[prop].isVersioned || items[i].name !== metadata.name){
                                    let newItem = items[i]
            
                                    if(offlineFilesInfo[prop].isVersioned){
                                        newItem.uuid = offlineFilesInfo[prop].versionedUUID
                                        newItem.region = offlineFilesInfo[prop].versionedInfo.region
                                        newItem.bucket = offlineFilesInfo[prop].versionedInfo.bucket
                                        newItem.chunks = offlineFilesInfo[prop].versionedInfo.chunks
                                        newItem.timestamp = offlineFilesInfo[prop].versionedInfo.timestamp
                                        newItem.rm = offlineFilesInfo[prop].versionedInfo.rm
                                        newItem.thumbnail = undefined
                                        newItem.date = simpleDate(offlineFilesInfo[prop].versionedInfo.timestamp)
                                    }

                                    newItem.offline = true
                                    newItem.name = metadata.name
                                    newItem.size = metadata.size
                                    newItem.mime = metadata.mime
                                    newItem.key = metadata.key
                                    newItem.lastModified = metadata.lastModified

                                    if(offlineFilesInfo[prop].isVersioned){
                                        queueFileDownload({
                                            file: newItem,
                                            storeOffline: true,
                                            isOfflineUpdate: true,
                                            optionalCallback: () => {
                                                removeFromOfflineStorage({
                                                    item: {
                                                        uuid: itemUUID,
                                                        name: itemName
                                                    } as Item
                                                })
    
                                                DeviceEventEmitter.emit("event", {
                                                    type: "remove-item",
                                                    data: {
                                                        uuid: itemUUID
                                                    }
                                                })
    
                                                DeviceEventEmitter.emit("event", {
                                                    type: "add-item",
                                                    data: {
                                                        item: newItem,
                                                        parent: newItem.parent
                                                    }
                                                })
                                            }
                                        }).catch(console.error)
                                    }
                                    else{
                                        await new Promise((resolve, reject) => {
                                            changeItemNameInOfflineList({ item: items[i], name: metadata.name }).then(() => {
                                                DeviceEventEmitter.emit("event", {
                                                    type: "change-item-name",
                                                    data: {
                                                        uuid: items[i].uuid,
                                                        name: metadata.name
                                                    }
                                                })

                                                return resolve(true)
                                            }).catch(reject)
                                        })
                                    }
                                }
                            }
                        }
                        catch(e){
                            console.log(e)
                        }
                    }
                    else{
                        try{
                            await removeFromOfflineStorage({ item: items[i] })
                        }
                        catch(e){
                            console.log(e)
                        }

                        DeviceEventEmitter.emit("event", {
                            type: "remove-item",
                            data: {
                                uuid: prop
                            }
                        })
                    }
                }
            }
        }
    }
    else{
        try{
            var response = await apiRequest({
                method: "POST",
                endpoint: "/v1/dir/content",
                data: {
                    apiKey: getAPIKey(),
                    uuid: parent,
                    folders: JSON.stringify(["default"]),
                    page: 1,
                    app: "true"
                }
            })
        }
        catch(e){
            console.log(e)

            return false
        }

        if(!response.status){
            console.log(response.message)

            return false
        }

        if(typeof cache !== "undefined" && parent !== "links"){
            if(cache.length > 0){
                try{
                    const responseString = JSON.stringify(response.data)

                    if(storage.getString(cacheKeyLastResponse) == responseString){
                        return false
                    }

                    storage.set(cacheKeyLastResponse, responseString)
                }
                catch(e){
                    console.log(e)
                }
            }
        }

        for(let i = 0; i < response.data.folders.length; i++){
			const folder = response.data.folders[i]
            const item = await buildFolder({ folder, masterKeys, userId, routeURL, loadFolderSizes })

			items.push(item)

			storage.set("itemCache:folder:" + folder.uuid, JSON.stringify(item))
		}

        for(let i = 0; i < response.data.uploads.length; i++){
            const file = response.data.uploads[i]
            const item = await buildFile({ file, masterKeys, userId })

            items.push(item)

			storage.set("itemCache:file:" + file.uuid, JSON.stringify(item))
        }
    }

    items = sortItems({ items, passedRoute: route })

    storage.set(cacheKey, JSON.stringify(items))

    if(getParent(route) == parent && isMounted()){
        setItems(items.filter(item => item !== null && typeof item.uuid == "string"))
        setLoadDone(true)
    }

    return true
}

/*
Clear last response cache
*/
export const clearLoadItemsCacheLastResponse = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try{
            const keys = storage.getAllKeys()

            for(let i = 0; i < keys.length; i++){
                if(keys[i].indexOf("loadItemsCache:lastResponse:") !== -1){
                    storage.delete(keys[i])
                }
            }
        }
        catch(e){
            console.log(e)
        }

        return resolve(true)
    })
}

/*
Update the item cache so we do not need to re-fetch data from the API
*/
export const updateLoadItemsCache = ({ item, routeURL = "", prop, value }: { item: Item, routeURL?: string, prop: any, value: any }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try{
            const keys = storage.getAllKeys()

            for(let i = 0; i < keys.length; i++){
                if(keys[i].indexOf(routeURL.length > 0 ? "loadItemsCache:" + routeURL : "loadItemsCache:") !== -1){
                    let cache = []
                    let didChange = false

                    try{
                        cache = JSON.parse(storage.getString(keys[i]) as string)
                    }
                    catch(err){
                        console.log(err)
                    }

                    for(let x = 0; x < cache.length; x++){
                        if(cache[x].uuid == item.uuid){
                            cache[x][prop] = value
                            didChange = true
                        }
                    }

                    if(didChange){
                        storage.set(keys[i], JSON.stringify(cache))
                    }
                }
            }
        }
        catch(e){
            console.log(e)
        }

        return resolve(true)
    })
}

/*
Update the item cache so we do not need to re-fetch data from the API
*/
export const removeLoadItemsCache = ({ item, routeURL = "" }: { item: Item, routeURL?: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try{
            const keys = storage.getAllKeys()

            for(let i = 0; i < keys.length; i++){
                if(keys[i].indexOf(routeURL.length > 0 ? "loadItemsCache:" + routeURL : "loadItemsCache:") !== -1){
                    let cache = []
                    let didChange = false

                    try{
                        cache = JSON.parse(storage.getString(keys[i]) as string)
                    }
                    catch(err){
                        console.log(err)
                    }

                    for(let x = 0; x < cache.length; x++){
                        if(cache[x].uuid == item.uuid){
                            cache.splice(x, 1)
                            didChange = true
                        }
                    }

                    if(didChange){
                        storage.set(keys[i], JSON.stringify(cache))
                    }
                }
            }
        }
        catch(e){
            console.log(e)
        }

        return resolve(true)
    })
}

/*
Update the item cache so we do not need to re-fetch data from the API
*/
export const emptyTrashLoadItemsCache = (): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try{
            const keys = storage.getAllKeys()

            for(let i = 0; i < keys.length; i++){
                if(keys[i].indexOf("loadItemsCache:trash") !== -1){
                    storage.delete(keys[i])
                }
            }
        }
        catch(e){
            console.log(e)
        }

        return resolve(true)
    })
}

/*
Update the item cache so we do not need to re-fetch data from the API
*/
export const addItemLoadItemsCache = ({ item, routeURL = "" }: { item: Item, routeURL?: string }): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try{
            const keys = storage.getAllKeys()

            for(let i = 0; i < keys.length; i++){
                if(keys[i].indexOf(routeURL.length > 0 ? "loadItemsCache:" + routeURL : "loadItemsCache:") !== -1){
                    let cache = []

                    try{
                        cache = JSON.parse(storage.getString(keys[i]) as string)
                    }
                    catch(err){
                        console.log(err)
                    }

                    if(cache.length > 0){
                        cache.push(item)

                        storage.set(keys[i], JSON.stringify(cache))
                    }
                }
            }
        }
        catch(e){
            console.log(e)
        }

        return resolve(true)
    })
}

export const previewItem = async ({ item, setCurrentActionSheetItem = true, navigation }: { item: Item, setCurrentActionSheetItem?: boolean, navigation?: any }) => {
    if(item.size >= (MB * 1024)){
        DeviceEventEmitter.emit("event", {
            type: "open-item-actionsheet",
            data: item
        })

        return
    }

    const previewType = getFilePreviewType(getFileExt(item.name))
    const canThumbnail = canCompressThumbnail(getFileExt(item.name))

    if(!["image", "video", "text", "code", "pdf", "doc", "audio"].includes(previewType)){
        DeviceEventEmitter.emit("event", {
            type: "open-item-actionsheet",
            data: item
        })

        return
    }

    let existsOffline = false
    let offlinePath = ""

    try{
        offlinePath = getItemOfflinePath(await getDownloadPath({ type: "offline" }), item)

        if((await fs.stat(offlinePath)).exists){
            existsOffline = true
        }
    }
    catch(e){
        //console.log(e)
    }

    if(previewType == "image"){
        if(!canThumbnail){
            DeviceEventEmitter.emit("event", {
                type: "open-item-actionsheet",
                data: item
            })
    
            return
        }

        if(typeof item.thumbnail !== "string"){
            return
        }

        if(!isOnline() && !existsOffline){
            showToast({ message: i18n(storage.getString("lang"), "deviceOffline") })

            return
        }
        
        return setImmediate(() => {
            const currentItems = useStore.getState().currentItems

            if(!Array.isArray(currentItems)){
                return
            }

            const currentImages: PreviewItem[] = []
            let currentIndex = 0
            const addedImages: Record<string, boolean> = {}
            let index = 0
            let imgFound = false

            for(let i = 0; i < currentItems.length; i++){
                const ext = getFileExt(currentItems[i].name)

                if(getFilePreviewType(ext) == "image" && canCompressThumbnail(ext) && !addedImages[currentItems[i].uuid]){
                    addedImages[currentItems[i].uuid] = true

                    if(currentItems[i].uuid == item.uuid){
                        currentIndex = index
                        imgFound = true
                    }
                    
                    currentImages.push({
                        uri: undefined,
                        name: currentItems[i].name,
                        index,
                        uuid: currentItems[i].uuid,
                        thumbnail: currentItems[i].thumbnail,
                        file: currentItems[i]
                    })

                    index += 1
                }
            }

            if(imgFound){
                navigationAnimation({ enable: true }).then(() => {
                    navigation.dispatch(StackActions.push("ImageViewerScreen", {
                        items: currentImages,
                        index: currentIndex
                    }))
                })
            }
        })
    }

    const open = (path: string, offlineMode: boolean = false) => {
        setTimeout(() => {
            useStore.setState({ fullscreenLoadingModalVisible: false })

            if(offlineMode){
                return FileViewer.open(path, {
                    displayName: item.name,
                    showOpenWithDialog: false
                }).then(() => {
                    //console.log(path)
                }).catch((err) => {
                    console.log(err)

                    showToast({ message: i18n(storage.getString("lang"), "couldNotOpenFileLocally", true, ["__NAME__"], [item.name]) })
                })
            }

            if(previewType == "video"){
                FileViewer.open(path, {
                    displayName: item.name,
                    showOpenWithDialog: false
                }).then(() => {
                    //console.log(path)
                }).catch((err) => {
                    console.log(err)

                    showToast({ message: i18n(storage.getString("lang"), "couldNotOpenFileLocally", true, ["__NAME__"], [item.name]) })
                })
            }
            else if(previewType == "pdf" || previewType == "doc"){
                FileViewer.open(path, {
                    displayName: item.name,
                    showOpenWithDialog: false
                }).then(() => {
                    //console.log(path)
                }).catch((err) => {
                    console.log(err)

                    showToast({ message: i18n(storage.getString("lang"), "couldNotOpenFileLocally", true, ["__NAME__"], [item.name]) })
                })
            }
            else if(previewType == "text" || previewType == "code"){
                fs.readAsString(path, "utf8").then((content) => {
                    if(setCurrentActionSheetItem){
                        useStore.setState({ currentActionSheetItem: item })
                    }

                    useStore.setState({
                        textEditorState: "view",
                        textEditorParent: item.parent,
                        createTextFileDialogName: item.name,
                        textEditorText: content
                    })
														
					navigationAnimation({ enable: true }).then(() => {
                        navigation.dispatch(StackActions.push("TextEditorScreen"))
                    })
                }).catch((err) => {
                    console.log(err)
                })
            }
        }, existsOffline ? 1 : 100)
    }

    if(existsOffline){
        open(offlinePath, true)

        return
    }

    if(!isOnline() && !existsOffline){
        showToast({ message: i18n(storage.getString("lang"), "deviceOffline") })

        return
    }

    if(storage.getBoolean("onlyWifiDownloads:" + storage.getNumber("userId")) && !isWifi()){
        showToast({ message: i18n(storage.getString("lang"), "onlyWifiDownloads") })

        return
    }

    useStore.setState({ fullscreenLoadingModalVisible: true, fullscreenLoadingModalDismissable: true })

    queueFileDownload({
        file: item,
        optionalCallback: (err: any, path: string) => {
            useStore.setState({ fullscreenLoadingModalVisible: false })

            if(err){
                console.log(err)

                showToast({ message: err.toString() })

                return
            }

            open(path)
        },
        isPreview: true
    }).catch((err) => {
        if(err == "stopped"){
            return
        }

        if(err == "wifiOnly"){
            showToast({ message: i18n(storage.getString("lang"), "onlyWifiDownloads") })

            return
        }

        console.error(err)

        showToast({ message: err.toString() })
    })
}

export const convertHeic = async (item: Item, path: string): Promise<string> => {
    const tmpPath = await getDownloadPath({ type: "temp" })
    const outputPath: string = tmpPath + item.uuid + "_convertHeic.jpg"

    try{
        if((await fs.stat(outputPath)).exists){
            return outputPath
        }
    }
    catch(e){
        //console.log(e)
    }

    return global.nodeThread.convertHeic({
        input: path,
        output: outputPath,
        format: "JPEG"
    })
}

export const addToSavedToGallery = async (asset: Asset) => {
    await getLocalAssetsMutex.acquire()

    try{
        const assetId = getAssetId(asset)
        const assetURI = await getAssetURI(asset)
        const stat = await fs.stat(assetURI)
        const cameraUploadLastModified = JSON.parse(storage.getString("cameraUploadLastModified") || "{}")
        const cameraUploadLastSize = JSON.parse(storage.getString("cameraUploadLastSize") || "{}")
        const cameraUploadLastModifiedStat = JSON.parse(storage.getString("cameraUploadLastModifiedStat") || "{}")

        cameraUploadLastModified[assetId] = asset.modificationTime
        cameraUploadLastSize[assetId] = stat.size
        cameraUploadLastModifiedStat[assetId] = stat.modificationTime

        storage.set("cameraUploadLastModified", JSON.stringify(cameraUploadLastModified))
        storage.set("cameraUploadLastSize", JSON.stringify(cameraUploadLastSize))
        storage.set("cameraUploadLastModifiedStat", JSON.stringify(cameraUploadLastModifiedStat))
    }
    catch(e){
        console.error(e)
    }

    getLocalAssetsMutex.release()
}